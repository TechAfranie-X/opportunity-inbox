import { eventNeedsReview } from "./opportunity.ts";
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
};

const FALLBACK = "We are not fully sure about this one.";

/** The extractor's reasons are evidence labels for developers; the person gets a sentence. */
export function plainReason(reason: string): string {
  if (/sender is ats/i.test(reason)) return "This came from a job-application system, so we could not tell which employer it is for.";
  if (/^company: weak evidence/i.test(reason)) return "We are not confident about the company name.";
  if (/^type: /i.test(reason)) return "We are not confident about what kind of update this is.";
  if (/^role: /i.test(reason)) return "We are not confident about the role.";
  return reason.replace(/^(company|type|role): /i, "").replace(/^./, (c) => c.toUpperCase()).replace(/[^.!?]$/, "$&.");
}

/** Events to check, active opportunities first, then newest first. Corrected or ignored events never appear: a person's word settles it. */
export function buildReviewQueue(opportunities: Opportunity[], policy: Policy = DEFAULT_POLICY): ReviewItem[] {
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
  return items;
}
