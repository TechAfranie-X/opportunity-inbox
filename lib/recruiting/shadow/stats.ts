/**
 * Statistics for the prospective evaluation. Pure and deterministic (seeded). Written for small, clustered, weighted data.
 *
 * Why this design:
 *  - Messages in one thread are not independent, and S2 observations carry weight 1/rate. Treating them as independent
 *    Bernoulli draws would overstate precision and could declare a claim "supported" on too little evidence.
 *  - Every proportion is therefore collapsed to THREAD-level totals, its effective sample size is the Kish size of those
 *    totals, (sum W_c)^2 / sum W_c^2, and the interval is Wilson at that effective size. With one equal-weight message per
 *    thread this is the ordinary Wilson interval; with larger threads or unequal weights it is wider. It assumes the
 *    worst case inside a thread (perfectly correlated), so it errs on the side of "inconclusive", never of false support.
 *  - Wilson is used because it behaves at 0% and 100% where a percentile bootstrap degenerates.
 *  - The paired improvement has no closed form, so it uses a percentile cluster bootstrap, resampling threads within each
 *    mailbox (a stratified cluster bootstrap), with a fixed seed.
 */

export type Unit = {
  /** Observation weight: 1 for the S1 census, 1/rate for a sampled S2 observation. */
  w: number;
  /** Outcome, 0 or 1. */
  s: number;
  /** Cluster id: the thread, namespaced by mailbox. */
  c: string;
};

export type Interval = [number, number];

export function wilson(p: number, n: number, z = 1.96): Interval {
  if (!(n > 0) || Number.isNaN(p)) return [0, 1];
  const z2 = z * z;
  const d = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, (centre - margin) / d), Math.min(1, (centre + margin) / d)];
}

export function kish(totals: number[]): number {
  const s = totals.reduce((a, b) => a + b, 0);
  const s2 = totals.reduce((a, b) => a + b * b, 0);
  return s2 > 0 ? (s * s) / s2 : 0;
}

export type Estimate = { p: number; lo: number; hi: number; nEff: number; units: number; clusters: number; weightSum: number };

function clusterTotals(units: Unit[]) {
  const byCluster = new Map<string, { W: number; S: number }>();
  for (const u of units) {
    const t = byCluster.get(u.c) ?? { W: 0, S: 0 };
    t.W += u.w;
    t.S += u.w * u.s;
    byCluster.set(u.c, t);
  }
  return [...byCluster.values()];
}

/** Weighted proportion with a thread-clustered, weight-adjusted Wilson interval. */
export function clusterProportion(units: Unit[], z = 1.96): Estimate {
  const totals = clusterTotals(units);
  const W = totals.reduce((a, t) => a + t.W, 0);
  const S = totals.reduce((a, t) => a + t.S, 0);
  if (!(W > 0)) return { p: NaN, lo: 0, hi: 1, nEff: 0, units: units.length, clusters: totals.length, weightSum: 0 };
  const p = S / W;
  const nEff = kish(totals.map((t) => t.W));
  const [lo, hi] = wilson(p, nEff, z);
  return { p, lo, hi, nEff, units: units.length, clusters: totals.length, weightSum: W };
}

/** Effective sample size alone (used by the evidence gate). */
export const effectiveSize = (units: Unit[]) => kish(clusterTotals(units).map((t) => t.W));

// ---- seeded randomness ----
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PairUnit = {
  w: number;
  /** 1 if the system under test found this positive. */
  a: number;
  /** 1 if the comparator found it. */
  b: number;
  c: string;
  /** Resampling stratum: the mailbox. */
  g: string;
};

export type PairedEstimate = { d: number; lo: number; hi: number; pa: number; pb: number; discordantA: number; discordantB: number; clusters: number };

/** Paired weighted difference (a minus b) over positives, with a stratified percentile cluster bootstrap. */
export function pairedDifference(units: PairUnit[], resamples: number, seed: number, confidence = 0.95): PairedEstimate {
  type Cl = { W: number; A: number; B: number };
  const strata = new Map<string, Map<string, Cl>>();
  let W = 0, A = 0, B = 0, discordantA = 0, discordantB = 0;
  for (const u of units) {
    const g = strata.get(u.g) ?? new Map<string, Cl>();
    const t = g.get(u.c) ?? { W: 0, A: 0, B: 0 };
    t.W += u.w; t.A += u.w * u.a; t.B += u.w * u.b;
    g.set(u.c, t);
    strata.set(u.g, g);
    W += u.w; A += u.w * u.a; B += u.w * u.b;
    if (u.a === 1 && u.b === 0) discordantA += 1;
    if (u.b === 1 && u.a === 0) discordantB += 1;
  }
  const clusters = [...strata.values()].reduce((n, g) => n + g.size, 0);
  if (!(W > 0)) return { d: NaN, lo: -1, hi: 1, pa: NaN, pb: NaN, discordantA, discordantB, clusters };
  const lists = [...strata.values()].map((g) => [...g.values()]);
  const rnd = mulberry32(seed);
  const draws: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let w = 0, a = 0, b = 0;
    for (const list of lists) {
      for (let i = 0; i < list.length; i += 1) {
        const t = list[Math.floor(rnd() * list.length)];
        w += t.W; a += t.A; b += t.B;
      }
    }
    draws.push(w > 0 ? (a - b) / w : 0);
  }
  draws.sort((x, y) => x - y);
  const tail = (1 - confidence) / 2;
  const lo = draws[Math.floor(tail * resamples)];
  const hi = draws[Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1)];
  return { d: (A - B) / W, lo, hi, pa: A / W, pb: B / W, discordantA, discordantB, clusters };
}

// ---- decisions ----
export type Verdict = "supported" | "not_supported" | "inconclusive";

/** A target that must be reached (recall, precision, accuracy): point >= target is necessary; the lower bound decides support. */
export function atLeast(e: Pick<Estimate, "p" | "lo">, target: number, lowerMin: number): Verdict {
  if (Number.isNaN(e.p)) return "inconclusive";
  if (e.p < target) return "not_supported";
  return e.lo >= lowerMin ? "supported" : "inconclusive";
}

/** A ceiling (error, review rate): point <= target is necessary; the upper bound decides support. */
export function atMost(e: Pick<Estimate, "p" | "hi">, target: number, upperMax: number): Verdict {
  if (Number.isNaN(e.p)) return "inconclusive";
  if (e.p > target) return "not_supported";
  return e.hi <= upperMax ? "supported" : "inconclusive";
}

/** Improvement over a comparator: a non-positive point estimate fails; a positive one needs the lower bound above the floor. */
export function improves(e: Pick<PairedEstimate, "d" | "lo">, floor = 0): Verdict {
  if (Number.isNaN(e.d)) return "inconclusive";
  if (e.d <= floor) return "not_supported";
  return e.lo > floor ? "supported" : "inconclusive";
}
