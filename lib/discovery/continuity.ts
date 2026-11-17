import { parseSender } from "../opportunities/normalize.ts";
import { contactKeyOf, type ThreadAnchor } from "../recruiting/extract.ts";
import { NEAR_MISS, isNearMiss } from "../reliability/flags.ts";
import type { Prediction } from "../recruiting/predictions.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";

/** The contact keys for the inbound senders in a chunk, so earlier anchors can be looked up in one query. */
export function contactKeysOf(emails: RecruitingEmail[]): string[] {
  const keys = new Set<string>();
  for (const e of emails) {
    if (e.outbound) continue;
    const address = parseSender(e.from).email;
    if (address) keys.add(contactKeyOf(address));
  }
  return [...keys];
}

/** A key is only ever built by contactKeyOf; anything else must never reach a query. */
export const isContactKey = (key: string) => /^contact:[0-9a-f]{20}$/.test(key);

/**
 * The prediction log states what the reader concluded about each message and must agree with the events shown. `buildPredictions`
 * reads a batch without stored context, so a message linked to an earlier candidacy through that context would be logged as
 * "not recruiting" while the product shows it as an event. This makes the log match the events, row for row.
 */
export function reconcilePredictions(predictions: Prediction[], events: ExtractedEvent[]): Prediction[] {
  const byMessage = new Map(events.filter((e) => !e.outbound && !isNearMiss(e)).map((e) => [e.gmailMessageId, e]));
  const near = new Set(events.filter(isNearMiss).map((e) => e.gmailMessageId));
  return predictions.map((p) => {
    // a near miss is NOT a recruiting decision: the log keeps the reader's rejection and records that it was surfaced for a human look
    if (near.has(p.gmailMessageId) && p.decision === "not_recruiting") return { ...p, signals: [...p.signals, NEAR_MISS] };
    const e = byMessage.get(p.gmailMessageId);
    if (!e || p.decision === "recruiting") return p;
    return {
      ...p,
      decision: "recruiting",
      senderDomain: e.senderDomain,
      type: e.type,
      company: e.company,
      role: e.role,
      eventDate: e.eventDate,
      dateKind: e.dateKind,
      confidence: e.confidence,
      fieldConfidence: e.fieldConfidence ?? null,
      signals: e.signals,
      reviewReasons: e.reviewReasons ?? [],
    };
  });
}

export type { ThreadAnchor };
