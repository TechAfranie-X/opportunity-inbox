import { investigate } from "../investigate/resolve.ts";
import { buildReviewQueue, type ReviewItem, type ReviewOptions } from "./review.ts";
import type { Policy } from "./policy.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import type { EffectiveEvent, Opportunity } from "./types.ts";

/**
 * Autonomy first. Every candidate for the Review screen (a doubt, an identity suggestion, a possible message) goes through the source evidence and the journey it sits in BEFORE a question is made.
 * The outcome is one of:
 *   handled     the message belongs to a journey and says what it says; whatever its confidence, nothing the student sees depends on it (listed with the reason, never hidden)
 *   setAside    nothing in the message speaks about the student's own process (marketing, a recommendation, a notice, an event, an account message, a started-not-submitted draft): kept with its reason
 *   unassigned  the message states something about the student's own process (an application, a programme) that could not safely be attached to ONE journey: neutral evidence, not pretended to be resolved
 *   ask         a CONSEQUENTIAL decision (an ending, an offer, which of several applications) that Gmail cannot settle: the question says what is missing, why the evidence cannot answer, and what depends on it
 * Low model confidence alone is never a question. Pure: stored fields and stamped facts, no message text.
 */
export type HandledKind = "support" | "stage" | "programme" | "draft" | "noise" | "prospecting" | "account" | "unassigned";
export type Handled = { event: EffectiveEvent; company: string; role: string | null; opportunityKey: string; kind: HandledKind; headline: string; why: string };
export type Ask = ReviewItem & { ask: { missing: string; whyNotResolved: string; decision: string } };
export type AutonomousReview = { asks: Ask[]; handled: Handled[]; setAside: Handled[]; unassigned: Handled[] };

const has = (e: EffectiveEvent, s: string) => e.signals.includes(s);
const hasPrefix = (e: EffectiveEvent, p: string) => e.signals.some((x) => x.startsWith(p));
const classOf = (e: EffectiveEvent) => e.signals.find((x) => x.startsWith("class:"))?.slice(6) ?? null;
const OWN_FACT = (e: EffectiveEvent) => has(e, "own:receipt") || has(e, "ending:own") || has(e, "withdrawal:ack") || hasPrefix(e, "program:") || hasPrefix(e, "req:") || has(e, "application confirmation") || has(e, "closure (fact)");
const STAGE_TYPES = new Set(["interview_invite", "interview_scheduled", "assessment", "assessment_completed", "offer", "rejection", "withdrawn"]);

/** A message outside every journey: what it is, from the facts stamped on it. */
export function dispositionOutside(e: EffectiveEvent): { kind: HandledKind; headline: string; why: string } {
  const c = classOf(e);
  if (c === "draft") return { kind: "draft", headline: "An application you started and did not submit", why: "The message reminds you to finish an application; it is not an application and changes no stage." };
  if (c === "marketing") return { kind: "prospecting", headline: "A campaign inviting you to apply", why: "A mass mailing with a call to apply: opportunities to consider, not part of your process." };
  if (c === "notice") return { kind: "prospecting", headline: "A platform notice or recommendation", why: "A job-match, digest, forward or platform notice: nothing here states your own application." };
  if (c === "admin") return { kind: "account", headline: "Account or verification mail", why: "A code, verification or account message: it carries no application." };
  if (c === "event" || c === "survey" || c === "community") return { kind: "noise", headline: c === "event" ? "An event or session registration" : c === "survey" ? "A survey" : "A community or simulation message", why: `A ${c} message with no programme or application journey to join.` };
  if (c === "logistics") return { kind: "account", headline: "Logistics (travel, background check, immigration)", why: "Support mail with no application of its own to attach to." };
  if (hasPrefix(e, "program:")) return { kind: "unassigned", headline: "Programme mail without a programme journey", why: "It speaks about a programme you are in or were offered, but no single programme journey could be tied to it safely. Kept as neutral evidence." };
  if (has(e, "own:receipt") || has(e, "ending:own") || has(e, "withdrawal:ack")) return { kind: "unassigned", headline: "States your own application, employer not matched", why: "The message states your application (or its end), but the employer could not be matched to one application. Kept as neutral evidence; it changes no state." };
  if (e.type === "recruiter_outreach") return { kind: "prospecting", headline: "Recruiter outreach to you", why: "An unsolicited recruiter or platform message: nothing in it states an application of yours." };
  return { kind: "noise", headline: "Mail that only resembles hiring", why: "Nothing in the message states your own application, interview, assessment, offer or ending, so it is not part of any journey." };
}

function handledInJourney(item: ReviewItem, o: Opportunity | undefined): Handled | null {
  const e = item.event;
  const mk = (kind: HandledKind, headline: string, why: string): Handled => ({ event: e, company: item.company, role: item.role, opportunityKey: item.opportunityKey, kind, headline, why });
  const c = classOf(e);
  if (c && c !== "program-acceptance") { const d = dispositionOutside(e); return mk(d.kind, d.headline, d.why); }
  if (hasPrefix(e, "program:") || o?.kind === "mentorship" || o?.kind === "scholarship" || o?.kind === "event") return mk("programme", "Part of its programme's journey", "The message is the programme's own mail and sits in the programme's journey; the journey shows where you are in the programme.");
  if (!STAGE_TYPES.has(e.type)) return mk("support", e.type === "applied" ? "An application receipt" : "A plain update in this journey", "It states no stage, date or ending, so whatever kind of update it is, it advances nothing; it is kept as evidence in this journey.");
  const rule = !has(e, "semantic:event");
  const facts = OWN_FACT(e);
  return mk("stage", `Kept as ${e.type.replace(/_/g, " ")}`, rule || has(e, "semantic:agree") || facts
    ? "Read from the message's own wording (by the rules, agreed by a second reader, or stated by a fact) and consistent with the journey it sits in. A lower confidence is not a reason to ask."
    : "Only a model reading supports this stage; such a reading never advances a journey on its own, so nothing depends on it.");
}

const askFor = (item: ReviewItem): Ask["ask"] => {
  const where = `${item.company}${item.role ? ` · ${item.role}` : ""}`;
  switch (item.kind) {
    case "proposed-ending": return { missing: `Whether your ${where} application has actually ended.`, whyNotResolved: "One message reads like an ending, nothing else in Gmail confirms or contradicts it, and the employer did not state the ending in plain words.", decision: "Whether this application leaves your active pipeline." };
    case "confirmation-conflict": return { missing: "Which of two readings of this message is right.", whyNotResolved: "You confirmed one reading; a later, independent reading of the same message disagrees, and your confirmation is never overridden silently.", decision: `What ${where} shows as the state of your application.` };
    case "ambiguous": return { missing: `Which of your applications at ${item.company} this ${item.event.type.replace(/_/g, " ")} belongs to.`, whyNotResolved: "Role, requisition, cycle and thread evidence fit more than one open application equally well.", decision: "Which application receives this stage or ending." };
    default: return { missing: `What happened in ${where}.`, whyNotResolved: item.reasons.join(" "), decision: "How this application's stage or outcome is shown." };
  }
};

/** Build the review screen the autonomy-first way. The raw candidate queue is still available (`buildReviewQueue`); this decides what becomes a question. */
export function buildAutonomousReview(opportunities: Opportunity[], policy: Policy = DEFAULT_POLICY, possible: EffectiveEvent[] = [], now: Date = new Date(), options: ReviewOptions = {}): AutonomousReview {
  const queue = buildReviewQueue(opportunities, policy, possible, now, options);
  const byKey = new Map(opportunities.map((o) => [o.key, o]));
  const res = options.investigate ? investigate(opportunities) : new Map();
  const out: AutonomousReview = { asks: [], handled: [], setAside: [], unassigned: [] };
  for (const item of queue) {
    const e = item.event;
    if (item.possible) {
      const d = dispositionOutside(e);
      const h: Handled = { event: e, company: item.company, role: null, opportunityKey: "", kind: d.kind, headline: d.headline, why: d.why };
      (d.kind === "unassigned" ? out.unassigned : out.setAside).push(h);
      continue;
    }
    const o = byKey.get(item.opportunityKey);
    const isDoubt = item.kind === "doubt" || item.kind === "suggestion" || item.kind === "ambiguous";
    // an identity ambiguity about a STAGE or ENDING is a real question; about a plain update it changes nothing
    const consequentialAmbiguity = item.kind === "ambiguous" && STAGE_TYPES.has(e.type) && !res.has(e.id);
    if (isDoubt && !consequentialAmbiguity) {
      const r = res.get(e.id);
      const h = handledInJourney(item, o);
      if (h) out.handled.push(r ? { ...h, why: `${r.explanation}` } : h);
      continue;
    }
    // contradictions that the message itself resolves are not questions (handled in lib/lifecycle/contradictions.ts); the rest are consequential
    out.asks.push({ ...item, tier: "important", ask: askFor(item) });
  }
  // mail the message-class facts already explain never reaches the queue, but it is not hidden: it is listed as set aside with its reason
  const inQueue = new Set(queue.map((i) => i.event.gmailMessageId));
  for (const e of possible) {
    if (e.outbound || inQueue.has(e.gmailMessageId) || !e.signals.some((x) => x.startsWith("class:"))) continue;
    const d = dispositionOutside(e);
    (d.kind === "unassigned" ? out.unassigned : out.setAside).push({ event: e, company: e.company ?? "Unknown sender", role: null, opportunityKey: "", kind: d.kind, headline: d.headline, why: d.why });
  }
  return out;
}

/** What the badge counts: genuine questions only. */
export const autonomousAttention = (r: AutonomousReview) => r.asks.length;
