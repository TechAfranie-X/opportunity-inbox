import type { EffectiveEvent, Opportunity } from "./types.ts";

/**
 * A person's "Looks right" vouches for the reading they were shown. If a LATER, independent reading of the same message says something consequential the confirmation does not
 * (an ending, a withdrawal, an offer), the application can sit open or unresolved on the strength of a reading nobody re-checked. Their confirmation stays authoritative and nothing
 * is rewritten; the disagreement becomes a Review question. Only plain confirmations are asked about: a person who explicitly set the type made a decision, not a vouching.
 */
export type LatestReading = { type: string; recruiting: boolean };
const CONSEQUENTIAL = new Set(["rejection", "withdrawn", "offer"]);
const WORDS: Record<string, string> = { rejection: "a rejection", withdrawn: "a withdrawal", offer: "an offer" };

export const confirmationConflictFor = (e: EffectiveEvent, latest: LatestReading | undefined): string | null => {
  if (!latest || !e.confirmed || e.corrected || e.outbound || !latest.recruiting) return null;
  if (!CONSEQUENTIAL.has(latest.type) || latest.type === e.type) return null;
  return `You confirmed this message as ${e.type.replace(/_/g, " ")}, but the latest reading of it says ${WORDS[latest.type]}. Which is right?`;
};

export function withConfirmationConflicts(opportunities: Opportunity[], latest: Map<string, LatestReading>): Opportunity[] {
  return opportunities.map((o) => {
    const found = o.events.flatMap((e) => { const text = confirmationConflictFor(e, latest.get(e.gmailMessageId)); return text ? [{ eventId: e.id, text }] : []; });
    return found.length > 0 ? { ...o, confirmationConflicts: found } : o;
  });
}
