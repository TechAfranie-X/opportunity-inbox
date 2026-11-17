/**
 * The markers the reliability layer leaves on an event, and the questions the rest of the product asks about them. No imports, so
 * anything (including client-side code) can use them without pulling in the reader.
 */
export const NEAR_MISS = "near-miss";
export const MEMBERSHIP_PREFIX = "membership:";
export const CONFLICT_PREFIX = "conflict:";

/** A weaker near miss: structurally plausible hiring mail (important, from a named person at an employer, about a job or internship) with no named application. Offered, never counted. */
export const NEAR_MISS_WEAK = "near-miss:weak";
export const isWeakNearMiss = (e: { signals: string[] }) => e.signals.includes(NEAR_MISS_WEAK);

/** A message the reader rejected but that structurally looks like hiring mail (or could not be read). Not part of the pipeline until a person says it is. */
export const isNearMiss = (e: { signals: string[] }) => e.signals.includes(NEAR_MISS);

/**
 * The reader cannot vouch for this event as it stands: either nothing ties it to one of the reader's applications and Gmail did not mark
 * it important ("membership"), or its wording argues with the type it was given ("conflict", for example a farewell on something typed
 * as an update). Doubt is always visible in review and never produces an urgent action, whatever deadline the text carries.
 */
export const hasDoubt = (e: { reviewReasons?: string[] }) => (e.reviewReasons ?? []).some((r) => r.startsWith(MEMBERSHIP_PREFIX) || r.startsWith(CONFLICT_PREFIX));
