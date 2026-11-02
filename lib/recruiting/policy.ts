/**
 * Confidence thresholds, in one place, so abstention is configurable and measurable.
 *
 * A value is only shown as fact when its confidence reaches the threshold; below it the value is withheld
 * (`unknown`) or flagged (`review`). The evaluation harness sweeps these numbers without touching the extractor.
 *
 * Defaults withhold nothing and flag for review below 0.6, which is what the product did before the policy existed.
 * They are deliberately NOT tuned: stricter values are chosen from DEV-RANDOM risk-coverage tables once there are
 * human labels, and then frozen before the BLIND run.
 */
export type FieldPolicy = { reviewBelow: number; unknownBelow: number };
export type PolicyField = "type" | "company" | "role";

export type Policy = {
  /** Default for any field without its own entry; also the event-level "needs review" line. */
  reviewBelow: number;
  /** Default withhold line. Disabled (0) until calibration data justifies a value. */
  unknownBelow: number;
  /** Per-field overrides. */
  fields?: Partial<Record<PolicyField, Partial<FieldPolicy>>>;
  /** An action built from an event less certain than this is never shown as overdue/today; it is downgraded to "worth a look" and marked uncertain. */
  urgentMinConfidence: number;
};

export const DEFAULT_POLICY: Policy = {
  reviewBelow: 0.6,
  unknownBelow: 0,
  // Per-field lines that flag only clear doubt: the employer where independent evidence disagrees or is missing (<= 0.35),
  // and an event type that rests on the weakest tier. Not calibrated; see the note above.
  fields: { type: { reviewBelow: 0.45 }, company: { reviewBelow: 0.4 } },
  urgentMinConfidence: 0,
};

export const forField = (policy: Policy, field: PolicyField): FieldPolicy => ({
  reviewBelow: policy.fields?.[field]?.reviewBelow ?? policy.reviewBelow,
  unknownBelow: policy.fields?.[field]?.unknownBelow ?? policy.unknownBelow,
});

export type DecisionState = "accepted" | "review" | "unknown";
export type Decision<T> = { value: T | null; confidence: number; state: DecisionState };

/**
 * Turn a scored candidate into a decision.
 * Invariant: a confident-looking wrong answer is worse than an honest "unknown", so low confidence withholds the
 * value rather than passing it on with a caveat.
 */
export function decide<T>(value: T | null, confidence: number, policy: Policy = DEFAULT_POLICY, field?: PolicyField): Decision<T> {
  const p = field ? forField(policy, field) : { reviewBelow: policy.reviewBelow, unknownBelow: policy.unknownBelow };
  if (value === null || value === undefined) return { value: null, confidence, state: "unknown" };
  if (confidence < p.unknownBelow) return { value: null, confidence, state: "unknown" };
  if (confidence < p.reviewBelow) return { value, confidence, state: "review" };
  return { value, confidence, state: "accepted" };
}

/** Read a policy from JSON (an environment variable), keeping only known numeric keys. Anything else falls back to the default. */
export function parsePolicy(json: string | undefined, base: Policy = DEFAULT_POLICY): Policy {
  if (!json) return base;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return base; }
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 1 ? v : undefined);
  const out: Policy = { ...base };
  out.reviewBelow = num(o.reviewBelow) ?? base.reviewBelow;
  out.unknownBelow = num(o.unknownBelow) ?? base.unknownBelow;
  out.urgentMinConfidence = num(o.urgentMinConfidence) ?? base.urgentMinConfidence;
  const fields = o.fields && typeof o.fields === "object" ? (o.fields as Record<string, unknown>) : {};
  const merged: NonNullable<Policy["fields"]> = { ...base.fields };
  for (const f of ["type", "company", "role"] as const) {
    const v = fields[f];
    if (v && typeof v === "object") merged[f] = { reviewBelow: num((v as Record<string, unknown>).reviewBelow), unknownBelow: num((v as Record<string, unknown>).unknownBelow) };
  }
  if (Object.keys(merged).length > 0) out.fields = merged;
  return out;
}
