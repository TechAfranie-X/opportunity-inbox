import { FROZEN } from "./frozen.ts";
import { atLeast, atMost, improves, mulberry32, pairedDifference, wilson, type PairUnit } from "./stats.ts";

/**
 * Power and precision analysis behind the minimum-evidence requirement. It evaluates the SAME decision functions the
 * final analysis uses (stats.ts), so the requirement cannot drift from the analysis.
 *
 * Every proportion claim is decided from (p-hat, effective size n), because the interval is Wilson at the effective
 * size (thread/opportunity clustering and the S2 weights are already folded into n). Power at a given effective size
 * is therefore an exact binomial calculation. Perfect within-cluster correlation is the worst case the interval assumes,
 * so the effective sizes derived here are conservative for real, less-correlated data.
 */

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i += 1) s += Math.log((n - k + i) / i);
  return s;
}

function pmf(n: number, k: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(the claim is SUPPORTED) for an "at least" claim, with n effective observations and true rate p. */
export function powerAtLeast(n: number, p: number, target: number, lowerMin: number): number {
  let total = 0;
  for (let k = 0; k <= n; k += 1) {
    const ph = k / n;
    if (atLeast({ p: ph, lo: wilson(ph, n)[0] }, target, lowerMin) === "supported") total += pmf(n, k, p);
  }
  return total;
}

/** P(the claim is SUPPORTED) for an "at most" claim. */
export function powerAtMost(n: number, p: number, target: number, upperMax: number): number {
  let total = 0;
  for (let k = 0; k <= n; k += 1) {
    const ph = k / n;
    if (atMost({ p: ph, hi: wilson(ph, n)[1] }, target, upperMax) === "supported") total += pmf(n, k, p);
  }
  return total;
}

/**
 * Smallest n whose power reaches `want` AND stays there for the next `hold` sizes. Power is not monotone in n for
 * discrete data (a larger n can need one more success), so the first crossing alone would be optimistic.
 */
export function minimumN(power: (n: number) => number, want = 0.8, max = 3000, hold = 25): number | null {
  for (let n = 5; n <= max; n += 1) {
    if (power(n) < want) continue;
    let ok = true;
    for (let m = n + 1; m <= n + hold && m <= max; m += 1) if (power(m) < want) { ok = false; break; }
    if (ok) return n;
  }
  return null;
}

/** Design truth for the improvement claim: the share of positives in each cell of the paired table. */
export type PairedDesign = { onlyV2: number; onlyComparator: number; both: number };
/**
 * Chosen from the size of the gap seen on development data (v2 found 13 positives the keyword path missed and lost none)
 * but deliberately more modest: v2 strict recall 0.80, comparator 0.62, difference 0.18, with a few comparator-only finds.
 */
export const IMPROVEMENT_DESIGN: PairedDesign = { onlyV2: 0.2, onlyComparator: 0.02, both: 0.6 };

/** P(improvement is SUPPORTED) for nPos effective positives, by simulating the real paired bootstrap. */
export function improvementPower(nPos: number, design: PairedDesign = IMPROVEMENT_DESIGN, reps = 200, resamples = 400, seed = 1): number {
  const r = mulberry32(seed);
  let hit = 0;
  for (let k = 0; k < reps; k += 1) {
    const units: PairUnit[] = [];
    for (let i = 0; i < nPos; i += 1) {
      const v = r();
      let a = 0, b = 0;
      if (v < design.onlyV2) a = 1;
      else if (v < design.onlyV2 + design.onlyComparator) b = 1;
      else if (v < design.onlyV2 + design.onlyComparator + design.both) { a = 1; b = 1; }
      units.push({ w: 1, a, b, c: `t${i}`, g: "m" });
    }
    if (improves(pairedDifference(units, resamples, seed * 100003 + k)) === "supported") hit += 1;
  }
  return hit / reps;
}

export type Requirement = { claim: string; design: string; effectiveN: number | null };

/** Expected effective positives per calendar week, for the feasibility table. */
export function weeklyEffectivePositives(weeklyEligible: number, prevalence: number, neffPerPositive: number, s1Share = 0.99) {
  return weeklyEligible * prevalence * s1Share * neffPerPositive;
}

/** Recomputes every minimum-evidence number from the design truths and the frozen claim thresholds. */
export function requirements(f: typeof FROZEN = FROZEN) {
  const d = f.powerDesign, c = f.claims;
  const atLeastN = (claim: { target: number; lowerMin: number }) => minimumN((n) => powerAtLeast(n, d.rate, claim.target, claim.lowerMin), d.power);
  const strictRecall = atLeastN(c.strictRecall);
  // Improvement: smallest multiple of 5 whose simulated power reaches the target and holds for the next two multiples.
  let improvement: number | null = null;
  for (let n = 10; n <= 200 && improvement === null; n += 5) {
    if ([n, n + 5, n + 10].every((m) => improvementPower(m, d.paired, 300, 400, 1) >= d.power)) improvement = n;
  }
  const round5 = (x: number) => Math.ceil(x / 5) * 5;
  return {
    recallPositives: round5(Math.max(strictRecall ?? 0, improvement ?? 0)),
    precisionDecisions: atLeastN(c.precision),
    typeDecisions: atLeastN(c.typeAccuracy),
    agreementRows: minimumN((n) => powerAtMost(n, d.agreementError, c.agreementError.target, c.agreementError.upperMax), d.power),
    reviewReads: minimumN((n) => powerAtMost(n, d.reviewRate, c.reviewRate.target, c.reviewRate.upperMax), d.power),
    detail: { strictRecallAlone: strictRecall, improvementAlone: improvement },
  };
}

/** Planning-only assumptions for the feasibility table (the analysis gate uses MEASURED effective sizes, not these). */
export const PLANNING = { weeklyEligible: 117, s1PositiveShare: 0.99, effectivePerPositive: 0.45, weeks: 14.9 };

export function feasibility(prevalence: number, p = PLANNING) {
  const perWeek = weeklyEffectivePositives(p.weeklyEligible, prevalence, p.effectivePerPositive, p.s1PositiveShare);
  const expectedByEnd = perWeek * p.weeks;
  return { prevalence, effectivePerWeek: perWeek, weeksToRequirement: FROZEN.minimumEvidence.recallPositives / perWeek, expectedEffectiveByEnd: expectedByEnd, reachesInTime: expectedByEnd >= FROZEN.minimumEvidence.recallPositives };
}
