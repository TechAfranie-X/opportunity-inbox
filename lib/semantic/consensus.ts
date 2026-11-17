import { candidateEvent } from "../reliability/assess.ts";
import { CONFLICT_PREFIX, NEAR_MISS_WEAK, isNearMiss, isWeakNearMiss } from "../reliability/flags.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { usable } from "./port.ts";

export const SECOND_READER_YES = "possible: a second reader recognised this as part of a hiring process";
export const SECOND_READER_NO = `${CONFLICT_PREFIX} a second reader read this as not recruiting`;

/**
 * Deterministic consensus between the rule reader (with the reliability layer) and a second, semantic reader. Disagreement is never
 * resolved by picking a winner; it is routed to a person. The second reader adds NO structured value to any event.
 *
 *   rules found nothing, second reader says recruiting      -> "possibly recruiting", counted (it was invisible; now it is asked about)
 *   weak near miss, second reader says recruiting           -> promoted to counted
 *   strong near miss (by structure), second reader says no  -> folded (offered, not counted)
 *   confident rules event, second reader says no            -> visible doubt, never an urgent action
 *   agreement, abstention, unverified or low certainty      -> no effect
 *
 * On development data (cached verified outputs, optimistic because the guide was written after seeing failures) this cut silent errors from
 * 10 to 4 at about 12 more counted review items per 1,000 messages; see docs/semantic-reader.md.
 */
export function applyConsensus(events: ExtractedEvent[], emails: RecruitingEmail[], opinions: Map<string, VerifiedOutput>): ExtractedEvent[] {
  if (opinions.size === 0) return events;
  const out = events.map((e) => {
    const op = opinions.get(e.gmailMessageId);
    if (!usable(op) || e.outbound) return e;
    if (isNearMiss(e)) {
      if (op.recruiting && isWeakNearMiss(e)) return { ...e, signals: [...e.signals.filter((s) => s !== NEAR_MISS_WEAK), "semantic:yes"], reviewReasons: [SECOND_READER_YES] };
      if (!op.recruiting && !isWeakNearMiss(e) && !e.signals.includes("semantic:yes") && !/could not read/.test((e.reviewReasons ?? []).join(" "))) return { ...e, signals: [...e.signals, NEAR_MISS_WEAK, "semantic:no"] };
      return e;
    }
    if (!op.recruiting) return { ...e, reviewReasons: [...new Set([...(e.reviewReasons ?? []), SECOND_READER_NO])], signals: [...e.signals, "semantic:no"] };
    return { ...e, signals: [...e.signals, "semantic:agree"] };
  });
  const have = new Set(out.map((e) => e.gmailMessageId));
  const added = emails.flatMap((m) => {
    if (m.outbound || have.has(m.id)) return [];
    const op = opinions.get(m.id);
    return usable(op) && op.recruiting ? [candidateEvent(m, "strong", SECOND_READER_YES, ["semantic:yes"])] : [];
  });
  return added.length > 0 ? [...out, ...added].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()) : out;
}
