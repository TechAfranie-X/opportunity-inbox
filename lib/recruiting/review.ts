import { eventNeedsReview } from "./opportunity.ts";
import { isWeakNearMiss } from "../reliability/flags.ts";
import { DEFAULT_POLICY, type Policy } from "./policy.ts";
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
};

/** What the badge and Today's nudge count: everything except the weak, folded suggestions. */
export const attentionCount = (queue: ReviewItem[]) => queue.filter((i) => !i.weak).length;

const FALLBACK = "We are not fully sure about this one.";

/** The extractor's reasons are evidence labels for developers; the person gets a sentence. */
export function plainReason(reason: string): string {
  if (/sender is ats/i.test(reason)) return "This came from a job-application system, so we could not tell which employer it is for.";
  if (/^company: weak evidence/i.test(reason)) return "We are not confident about the company name.";
  if (/^membership: /i.test(reason)) return "We could not tie this to one of your applications. Is it really about a job or internship?";
  if (/^conflict: /i.test(reason)) return "The wording reads like a goodbye, but we read it as an ongoing update. Did they say no?";
  if (/^possible: we could not read/i.test(reason)) return "We could not read the text of this email, so we could not tell what it is. Open it to check.";
  if (/^possible: /i.test(reason)) return "This may be hiring mail that we did not recognise. We have not added it to your pipeline.";
  if (/^company: the name could not be found/i.test(reason)) return "We could not find the company name in the email.";
  if (/^type: /i.test(reason)) return "We are not confident about what kind of update this is.";
  if (/^role: /i.test(reason)) return "We are not confident about the role.";
  return reason.replace(/^(company|type|role): /i, "").replace(/^./, (c) => c.toUpperCase()).replace(/[^.!?]$/, "$&.");
}

/** Events to check, active opportunities first, then newest first. Corrected or ignored events never appear: a person's word settles it. */
export function buildReviewQueue(opportunities: Opportunity[], policy: Policy = DEFAULT_POLICY, possible: EffectiveEvent[] = []): ReviewItem[] {
  const items: ReviewItem[] = [];
  const activeKeys = new Set(opportunities.filter((o) => o.status === "active").map((o) => o.key));
  for (const o of opportunities) {
    for (const event of o.events) {
      // An event with no employer at all is always worth a look: it sits under "Unknown company" until someone names it.
      const unnamed = !event.company && !event.corrected && !event.confirmed;
      if (event.outbound || !(unnamed || eventNeedsReview(event, policy))) continue;
      const reasons = event.reviewReasons?.length ? [...new Set(event.reviewReasons.map(plainReason))] : [!event.company ? "We could not tell which company this is from." : FALLBACK];
      items.push({ event, opportunityKey: o.key, company: o.company, role: o.role, reasons });
    }
  }
  items.sort((a, b) => Number(activeKeys.has(b.opportunityKey)) - Number(activeKeys.has(a.opportunityKey)) || b.event.occurredAt.getTime() - a.event.occurredAt.getTime());
  const maybe = possible
    .filter((e) => !e.outbound)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((event): ReviewItem => ({ event, opportunityKey: "", company: event.company ?? "Unknown sender", role: null, reasons: [...new Set((event.reviewReasons ?? []).map(plainReason))], possible: true, ...(isWeakNearMiss(event) ? { weak: true } : {}) }));
  return [...items, ...maybe];
}
