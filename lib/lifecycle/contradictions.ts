import type { EffectiveEvent } from "../recruiting/types.ts";

/**
 * Contradictions: competing evidence inside ONE opportunity that no rule should silently settle. The reducer still produces a state (the latest credible
 * evidence wins), but the person is told the record disagrees with itself, because a wrong guess here hides a missed chance or an accepted offer.
 * Only the employer's or the person's own words count (outbound replies are the person's); a person's confirmation settles the item.
 *  - reopened: a rejection or withdrawal followed by progress (an assessment, interview or offer)
 *  - ambiguous_identity: a message that names no role at an employer with several live applications; it was kept apart rather than guessed
 *  - offer_ended: an offer followed by a rejection or withdrawal (rescinded, declined, or a mistake)
 */
export type Contradiction = { kind: "reopened" | "offer_ended" | "ambiguous_identity"; eventIds: string[]; text: string };

const PROGRESS = new Set(["assessment", "interview_invite", "interview_scheduled", "offer"]);
const ENDING = new Set(["rejection", "withdrawn"]);

export function detectContradictions(events: EffectiveEvent[]): Contradiction[] {
  const out: Contradiction[] = [];
  const credible = events.filter((e) => !e.outbound || e.type === "withdrawn");
  let lastEnd: EffectiveEvent | null = null;
  let lastOffer: EffectiveEvent | null = null;
  for (const e of credible) {
    if (e.corrected || e.confirmed) { if (ENDING.has(e.type)) lastEnd = e; continue; }
    if (ENDING.has(e.type)) {
      if (lastOffer && !lastEnd) out.push({ kind: "offer_ended", eventIds: [lastOffer.id, e.id], text: "An offer was followed by a message that ends the process. Check what happened." });
      lastEnd = e;
    } else if (PROGRESS.has(e.type) && lastEnd) {
      out.push({ kind: "reopened", eventIds: [lastEnd.id, e.id], text: "A rejection or withdrawal was followed by new progress. Check whether the process was reopened or this is a different application." });
      lastEnd = null;
    }
    if (e.type === "offer") lastOffer = e;
  }
  for (const e of events) if (e.signals.includes("identity:ambiguous") && !e.corrected && !e.confirmed) out.push({ kind: "ambiguous_identity", eventIds: [e.id], text: "We could not tell which of your applications to this employer this message is about. Check where it belongs." });
  return out;
}
