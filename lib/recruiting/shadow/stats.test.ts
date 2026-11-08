import assert from "node:assert/strict";
import test from "node:test";
import { atLeast, atMost, clusterProportion, effectiveSize, improves, kish, mulberry32, pairedDifference, wilson, type PairUnit, type Unit } from "./stats.ts";

const near = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("wilson matches known values and behaves at the boundaries", () => {
  const [lo, hi] = wilson(0.5, 100);
  near(lo, 0.4038); near(hi, 0.5962);
  near(wilson(1, 10)[0], 0.7224); assert.equal(wilson(1, 10)[1], 1);
  near(wilson(0, 10)[1], 0.2775); assert.equal(wilson(0, 10)[0], 0);
  assert.deepEqual(wilson(0.5, 0), [0, 1]);
  assert.deepEqual(wilson(NaN, 10), [0, 1]);
});

test("kish size equals n for equal weights and shrinks with unequal ones", () => {
  assert.equal(kish([1, 1, 1, 1]), 4);
  assert.equal(kish([2, 2]), 2);
  assert.ok(kish([1, 1, 1, 4]) < 4);
  assert.equal(kish([]), 0);
});

const mk = (n: number, successes: number, perThread = 1, w = 1): Unit[] => Array.from({ length: n }, (_, i) => ({ w, s: i < successes ? 1 : 0, c: `t${Math.floor(i / perThread)}` }));

test("independent equal-weight units reduce to the ordinary Wilson interval", () => {
  const e = clusterProportion(mk(40, 36));
  near(e.p, 0.9); assert.equal(e.nEff, 40);
  const [lo, hi] = wilson(0.9, 40);
  near(e.lo, lo); near(e.hi, hi);
});

test("thread clustering shrinks the effective size and widens the interval (never narrows it)", () => {
  const solo = clusterProportion(mk(40, 36, 1));
  const pairs = clusterProportion(mk(40, 36, 2));
  const fours = clusterProportion(mk(40, 36, 4));
  assert.equal(pairs.nEff, 20);
  assert.equal(fours.nEff, 10);
  assert.ok(pairs.lo < solo.lo && fours.lo < pairs.lo);
  assert.ok(pairs.hi >= solo.hi);
});

test("S2 weights (4) reduce the effective size relative to the same number of census observations", () => {
  const census = Array.from({ length: 50 }, (_, i) => ({ w: 1, s: 1, c: `a${i}` }));
  const withS2 = [...census.slice(0, 48), { w: 4, s: 1, c: "b1" }, { w: 4, s: 1, c: "b2" }];
  assert.ok(effectiveSize(withS2) < effectiveSize(census));
  near(clusterProportion([{ w: 1, s: 1, c: "x" }, { w: 4, s: 0, c: "y" }]).p, 0.2, 1e-9);
});

test("empty input is reported as not computable, not as zero", () => {
  const e = clusterProportion([]);
  assert.ok(Number.isNaN(e.p));
  assert.equal(atLeast(e, 0.8, 0.7), "inconclusive");
  assert.equal(atMost(e, 0.02, 0.04), "inconclusive");
});

test("decision rules: point below target is NOT SUPPORTED, point ok but interval short is INCONCLUSIVE, both ok is SUPPORTED", () => {
  assert.equal(atLeast({ p: 0.79, lo: 0.9 }, 0.8, 0.7), "not_supported");
  assert.equal(atLeast({ p: 0.85, lo: 0.69 }, 0.8, 0.7), "inconclusive");
  assert.equal(atLeast({ p: 0.85, lo: 0.7 }, 0.8, 0.7), "supported");
  assert.equal(atLeast({ p: 0.8, lo: 0.7 }, 0.8, 0.7), "supported", "boundaries are inclusive");
  assert.equal(atMost({ p: 0.03, hi: 0.01 }, 0.02, 0.04), "not_supported");
  assert.equal(atMost({ p: 0.01, hi: 0.05 }, 0.02, 0.04), "inconclusive");
  assert.equal(atMost({ p: 0.02, hi: 0.04 }, 0.02, 0.04), "supported");
  assert.equal(improves({ d: 0, lo: -0.1 }), "not_supported");
  assert.equal(improves({ d: -0.2, lo: -0.4 }), "not_supported");
  assert.equal(improves({ d: 0.2, lo: 0 }), "inconclusive");
  assert.equal(improves({ d: 0.2, lo: 0.01 }), "supported");
});

test("the seeded generator is deterministic and roughly uniform", () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 20; i += 1) assert.equal(a(), b());
  const r = mulberry32(99);
  const xs = Array.from({ length: 20000 }, () => r());
  near(xs.reduce((s, x) => s + x, 0) / xs.length, 0.5, 0.01);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

const pairs = (n: number, both: number, onlyA: number, onlyB: number, perThread = 1, g = "m1"): PairUnit[] => {
  const out: PairUnit[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = i < both + onlyA ? 1 : 0;
    const b = i < both ? 1 : i >= both + onlyA && i < both + onlyA + onlyB ? 1 : 0;
    out.push({ w: 1, a, b, c: `${g}-t${Math.floor(i / perThread)}`, g });
  }
  return out;
};

test("paired difference: a clear improvement has a lower bound above zero; no difference does not", () => {
  const clear = pairedDifference(pairs(60, 30, 20, 0), 2000, 11);
  near(clear.d, 20 / 60, 1e-9);
  assert.ok(clear.lo > 0);
  assert.equal(improves(clear), "supported");
  const none = pairedDifference(pairs(60, 40, 0, 0), 2000, 11);
  assert.equal(none.d, 0);
  assert.equal(improves(none), "not_supported");
  const noisy = pairedDifference(pairs(30, 5, 3, 2), 2000, 11);
  assert.ok(noisy.lo <= 0 && noisy.d > 0);
  assert.equal(improves(noisy), "inconclusive");
});

test("the bootstrap is deterministic for a seed and depends on the seed", () => {
  const u = pairs(40, 10, 8, 3);
  assert.deepEqual(pairedDifference(u, 500, 5), pairedDifference(u, 500, 5));
  assert.notDeepEqual(pairedDifference(u, 500, 5).lo, pairedDifference(u, 500, 6).lo);
});

test("the bootstrap resamples whole threads: clustering widens the interval", () => {
  const solo = pairedDifference(pairs(60, 30, 20, 0, 1), 2000, 3);
  const clustered = pairedDifference(pairs(60, 30, 20, 0, 6), 2000, 3);
  assert.ok(clustered.hi - clustered.lo > solo.hi - solo.lo, `${clustered.hi - clustered.lo} vs ${solo.hi - solo.lo}`);
});

test("stratified resampling: each mailbox keeps its own number of threads", () => {
  const u = [...pairs(20, 10, 5, 0, 1, "m1"), ...pairs(20, 10, 5, 0, 1, "m2")];
  const e = pairedDifference(u, 500, 4);
  assert.equal(e.clusters, 40);
  near(e.d, 10 / 40, 1e-9);
});

// ---- calibration: the intervals must cover the truth at about the nominal rate ----
function simulateCoverage(truth: number, n: number, perThread: number, reps: number, seed: number) {
  const r = mulberry32(seed);
  let cover = 0;
  for (let k = 0; k < reps; k += 1) {
    const units: Unit[] = [];
    for (let t = 0; t < Math.ceil(n / perThread); t += 1) {
      const s = r() < truth ? 1 : 0; // perfectly correlated within a thread: the worst case the interval assumes
      for (let j = 0; j < perThread && units.length < n; j += 1) units.push({ w: 1, s, c: `t${t}` });
    }
    const e = clusterProportion(units);
    if (e.lo <= truth && truth <= e.hi) cover += 1;
  }
  return cover / reps;
}

test("calibration: Wilson at the effective size covers the true value at about 95% for independent data", () => {
  const c = simulateCoverage(0.85, 60, 1, 2000, 1);
  assert.ok(c > 0.92 && c < 0.985, `coverage ${c}`);
});

test("calibration: with fully correlated threads the interval is conservative, never anti-conservative", () => {
  const c = simulateCoverage(0.85, 60, 3, 2000, 2);
  assert.ok(c >= 0.93, `coverage ${c}`);
});

test("calibration: the paired bootstrap covers the true difference at roughly the nominal rate", () => {
  const r = mulberry32(5);
  const trueA = 0.85, trueB = 0.6;
  const truth = trueA - trueB;
  let cover = 0;
  const reps = 300;
  for (let k = 0; k < reps; k += 1) {
    const units: PairUnit[] = [];
    for (let i = 0; i < 50; i += 1) {
      const b = r() < trueB ? 1 : 0;
      // a is nested to make the pair correlated: if the comparator found it, v2 almost always does too
      const a = b ? (r() < 0.97 ? 1 : 0) : (r() < (trueA - trueB * 0.97) / (1 - trueB) ? 1 : 0);
      units.push({ w: 1, a, b, c: `t${i}`, g: "m" });
    }
    const e = pairedDifference(units, 400, k + 1);
    if (e.lo <= truth && truth <= e.hi) cover += 1;
  }
  assert.ok(cover / reps > 0.88, `coverage ${cover / reps}`);
});
