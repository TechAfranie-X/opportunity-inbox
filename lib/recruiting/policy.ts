/**
 * Confidence thresholds, in one place, so abstention is configurable and measurable.
 *
 * A field is only shown as fact when its confidence reaches the threshold; below it the value is withheld
 * (`unknown`) or flagged (`review`). The evaluation harness sweeps these numbers without touching the extractor.
 *
 * The defaults reproduce the behaviour before the policy existed, so introducing it changes no output.
 */
export type Policy = {
  /** Below this, an event's overall confidence marks its opportunity "needs review". */
  reviewBelow: number;
  /** Below this, a value is withheld entirely and reported as unknown. Disabled (0) until the resolver provides calibrated scores. */
  unknownBelow: number;
};

export const DEFAULT_POLICY: Policy = { reviewBelow: 0.6, unknownBelow: 0 };

export type DecisionState = "accepted" | "review" | "unknown";
export type Decision<T> = { value: T | null; confidence: number; state: DecisionState };

/**
 * Turn a scored candidate into a decision.
 * Invariant: a confident-looking wrong answer is worse than an honest "unknown", so low confidence withholds the
 * value rather than passing it on with a caveat.
 */
export function decide<T>(value: T | null, confidence: number, policy: Policy = DEFAULT_POLICY): Decision<T> {
  if (value === null || value === undefined) return { value: null, confidence, state: "unknown" };
  if (confidence < policy.unknownBelow) return { value: null, confidence, state: "unknown" };
  if (confidence < policy.reviewBelow) return { value, confidence, state: "review" };
  return { value, confidence, state: "accepted" };
}
