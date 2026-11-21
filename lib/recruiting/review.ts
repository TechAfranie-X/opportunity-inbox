import { eventNeedsReview } from "./opportunity.ts";
import { isWeakNearMiss } from "../reliability/flags.ts";
import { DEFAULT_POLICY, type Policy } from "./policy.ts";
import { prioritize } from "./review-priority.ts";
import type { EffectiveEvent, Opportunity } from "./types.ts";

/**
 * One thing the product is unsure about and wants the person to check. The primary object stays the opportunity; the review
 * queue is the short list of events whose type or employer the policy says to doubt. Only stored fields are used (no email text).
 */
export type ReviewItem = {
  event: EffectiveEvent;
  opportunityKey: string;
  company: string;
  role: string | null;
  /** Plain-language reasons, never message text. */
  reasons: string[];
  /** A message the reader did not recognise as hiring mail but that looks like it. It is not in the pipeline until the person says so. */
  possible?: boolean;
  /** A weak near miss: offered in a folded list and never counted in the badge. */
  weak?: boolean;
  /** How much resolving this matters to live recruiting, higher first. Ranks the triage; never shown as a number. */
  impact: number;
  /** "important" items touch active recruiting or a decision; the rest is housekeeping. */
  tier: "important" | "routine";
  /** Plain-language reason it ranks where it does. */
  why: string;
  /** What kind of question this is (used by the prioritisation, lib/recruiting/review-priority.ts). */
  kind?: "doubt" | "contradiction" | "ambiguous" | "proposed-ending" | "suggestion" | "confirmation-conflict" | "possible";
  /** An optional suggestion, not a question the person needs to answer: shown collapsed and never counted. */
  suggestion?: boolean;
  /** How many similar questions about the same application were folded into this one. */
  similar?: number;
};

export type ReviewOptions = { prioritize?: boolean };

const DAY_MS = 86_400_000;
const IMPORTANT_AT = 45;
const TYPE_WEIGHT: Partial<Record<string, number>> = { offer: 30, rejection: 24, interview_scheduled: 26, interview_invite: 24, assessment: 24, recruiter_outreach: 14 };

/**
 * Rank by impact on live recruiting, not by arrival: an offer, an interview or an assessment on an active opportunity, or a doubt that
 * could be hiding a rejection, comes before a housekeeping question about an old follow-up. Pure; uses only stored fields.
 */
export function reviewImpact(item: { event: EffectiveEvent; active: boolean; possible: boolean; reasons: string[] }, now: Date): { impact: number; why: string } {
  const e = item.event;
  let impact = item.possible ? 20 : 5;
  let why = item.possible ? "Might be a missed opportunity" : "Housekeeping";
  if (item.active) { impact += 35; why = "On an active opportunity"; }
  const w = TYPE_WEIGHT[e.type] ?? 0;
  if (w && !item.possible) { impact += w; if (item.active) why = `${why}, ${e.type.replace(/_/g, " ")}`; }
  if (e.eventDate && e.eventDate.getTime() >= now.getTime() - DAY_MS) { impact += 20; why = "Has an upcoming date"; }
  if (item.reasons.some((r) => /goodbye|say no/i.test(r))) { impact += 20; why = "Might be a rejection"; }
  const age = (now.getTime() - e.occurredAt.getTime()) / DAY_MS;
  if (age <= 7) impact += 10; else if (age > 60) impact -= 10;
  return { impact, why };
}

/**
 * What the navigation and Today count: only the reviews that matter to live recruiting. Housekeeping and weak suggestions stay reachable on the
 * Check screen but never inflate the number, so "3 need review" is a real statement, not a to-do list.
 */
export const attentionCount = (queue: ReviewItem[]) => queue.filter((i) => !i.weak && i.tier === "important").length;

const FALLBACK = "We are not fully sure about this one.";

/** The extractor's reasons are evidence labels for developers; the person gets a sentence. */
export function plainReason(reason: string): string {
  if (/sender is ats/i.test(reason)) return "This came from a job-application system, so we could not tell which employer it is for.";
  if (/^company: weak evidence/i.test(reason)) return "We are not confident about the company name.";
  if (/^membership: /i.test(reason)) return "We could not tie this to one of your applications. Is it really about a job or internship?";
  if (/^conflict: a second reader/i.test(reason)) return "A second reader thinks this is not recruiting mail. Is it?";
  if (/^possible: a second reader/i.test(reason)) return "A second reader thinks this is hiring mail that we did not recognise. We have not added it to your pipeline.";
  if (/^conflict: /i.test(reason)) return "The wording reads like a goodbye, but we read it as an ongoing update. Did they say no?";
  if (/^possible: we could not read/i.test(reason)) return "We could not read the text of this email, so we could not tell what it is. Open it to check.";
  if (/^possible: /i.test(reason)) return "This may be hiring mail that we did not recognise. We have not added it to your pipeline.";
  if (/^company: the name could not be found/i.test(reason)) return "We could not find the company name in the email.";
  if (/^type: /i.test(reason)) return "We are not confident about what kind of update this is.";
  if (/^role: /i.test(reason)) return "We are not confident about the role.";
  return reason.replace(/^(company|type|role): /i, "").replace(/^./, (c) => c.toUpperCase()).replace(/[^.!?]$/, "$&.");
}

/** Events to check, active opportunities first, then newest first. Corrected or ignored events never appear: a person's word settles it. */
export function buildReviewQueue(opportunities: Opportunity[], policy: Policy = DEFAULT_POLICY, possible: EffectiveEvent[] = [], now: Date = new Date(), options: ReviewOptions = {}): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const o of opportunities) {
    for (const event of o.events) {
      // An event with no employer at all is always worth a look: it sits under "Unknown company" until someone names it.
      const unnamed = !event.company && !event.corrected && !event.confirmed;
      if (event.outbound || !(unnamed || eventNeedsReview(event, policy))) continue;
      const reasons = event.reviewReasons?.length ? [...new Set(event.reviewReasons.map(plainReason))] : [!event.company ? "We could not tell which company this is from." : FALLBACK];
      const { impact, why } = reviewImpact({ event, active: o.status === "active", possible: false, reasons }, now);
      items.push({ event, opportunityKey: o.key, company: o.company, role: o.role, reasons, impact, why, tier: impact >= IMPORTANT_AT ? "important" : "routine", kind: "doubt" });
    }
  }
  // Competing evidence inside one opportunity (a rejection followed by an interview, an offer followed by an ending) is always worth a look while it is live.
  for (const o of opportunities) {
    for (const c of o.contradictions ?? []) {
      const event = o.events.find((e) => e.id === c.eventIds[c.eventIds.length - 1]);
      if (!event || event.corrected || event.confirmed || items.some((i) => i.event === event && i.reasons.includes(c.text))) continue;
      const { impact, why } = reviewImpact({ event, active: o.status === "active", possible: false, reasons: [c.text] }, now);
      const live = Math.max(impact, IMPORTANT_AT);
      items.push({ event, opportunityKey: o.key, company: o.company, role: o.role, reasons: [c.text], impact: live, why: o.status === "active" ? "The record disagrees with itself" : why, tier: "important" , kind: c.kind === "ambiguous_identity" ? "ambiguous" : "contradiction" });
    }
  }
  // A person's confirmation that a later reading of the same message disagrees with: they stay authoritative, and they are asked.
  for (const o of opportunities) {
    for (const c of o.confirmationConflicts ?? []) {
      const event = o.events.find((e) => e.id === c.eventId);
      if (!event || items.some((i) => i.event === event && i.reasons.includes(c.text))) continue;
      items.push({ event, opportunityKey: o.key, company: o.company, role: o.role, reasons: [c.text], impact: Math.max(IMPORTANT_AT, 60), why: "Your confirmation and a later reading disagree", tier: "important", kind: "confirmation-conflict" });
    }
  }
  // An ending that rests on one uncorroborated reading is proposed, not settled (the application stays active): the question is only whether it is worth asking.
  for (const o of opportunities) {
    const p = o.proposedEnding; const event = p && o.events.find((e) => e.id === p.eventId);
    if (!p || !event || event.corrected || event.confirmed) continue;
    const text = p.outcome === "rejected" ? "One message looks like a rejection, but nothing else confirms it. Is this application over?" : "One message looks like a withdrawal, but nothing else confirms it. Is this application over?";
    items.push({ event, opportunityKey: o.key, company: o.company, role: o.role, reasons: [text], impact: 40, why: "An ending nobody has confirmed", tier: "routine", kind: "proposed-ending" });
  }
  // An optional identity suggestion: this message may belong to another application (evidence short of the bar for linking).
  for (const o of opportunities) for (const event of o.events) {
    const sug = event.signals.find((x) => x.startsWith("identity:suggest:"));
    if (!sug || event.corrected || event.confirmed || event.outbound) continue;
    items.push({ event, opportunityKey: o.key, company: o.company, role: o.role, reasons: ["This message may belong to another of your applications, but the evidence is not strong enough to join them. Keep them apart, or link them?"], impact: 10, why: "An optional suggestion", tier: "routine", kind: "suggestion" });
  }
  items.sort((a, b) => b.impact - a.impact || b.event.occurredAt.getTime() - a.event.occurredAt.getTime());
  const maybe = possible
    .filter((e) => !e.outbound)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((event): ReviewItem => {
      const reasons = [...new Set((event.reviewReasons ?? []).map(plainReason))];
      const weak = isWeakNearMiss(event);
      const { impact, why } = reviewImpact({ event, active: false, possible: true, reasons }, now);
      return { event, opportunityKey: "", company: event.company ?? "Unknown sender", role: null, reasons, possible: true, kind: "possible" as const, ...(weak ? { weak: true } : {}), impact: weak ? 0 : impact, why, tier: !weak && impact >= IMPORTANT_AT ? "important" : "routine" };
    });
  const queue = [...items, ...maybe].sort((a, b) => Number(Boolean(a.weak)) - Number(Boolean(b.weak)) || b.impact - a.impact || b.event.occurredAt.getTime() - a.event.occurredAt.getTime());
  return options.prioritize ? prioritize(queue, opportunities, now) : queue;
}
