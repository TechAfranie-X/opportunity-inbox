import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { LOWER_IS_BETTER, TOLERANCE, compare, metricsOf, type Metrics } from "../../scripts/eval-gate.ts";

const counts = { tp: 90, fp: 2, fn: 10, tn: 50, typeOk: 80, typeN: 90, pairTp: 60, pairFp: 6, pairFn: 14, journeys: 30, noHome: 0, split: 3, merged: 2, statusOk: 26, outcomeOk: 20, stageOk: 18, stageN: 25, actOk: 15, actNormOk: 16, actNormN: 22, evidenceOk: 28, evidenceN: 30, contra: 5, contraFlagged: 3, reviewItems: 20, reviewJustified: 12, attention: 8, attentionJustified: 5 };
const tol = { points: TOLERANCE.points, countShare: TOLERANCE.countShare, countFloor: TOLERANCE.countFloor };

test("the gate fails a drop in recall, status or outcome and passes an improvement", () => {
  const base = metricsOf(counts);
  assert.deepEqual(compare(base, base, "x", tol), []);
  assert.equal(compare(base, { ...base, recruitingRecall: base.recruitingRecall - 2 }, "x", tol).length, 1);
  assert.equal(compare(base, { ...base, statusAccuracy: base.statusAccuracy - 3 }, "x", tol).length, 1);
  assert.equal(compare(base, { ...base, outcomeAccuracy: base.outcomeAccuracy - 1.5 }, "x", tol).length, 1);
  assert.deepEqual(compare(base, { ...base, recruitingRecall: base.recruitingRecall + 5, statusAccuracy: base.statusAccuracy + 5 }, "x", tol), []);
  assert.deepEqual(compare(base, { ...base, recruitingRecall: base.recruitingRecall - 0.5 }, "x", tol), [], "within tolerance");
});

test("the gate fails growth in false opportunities, wrong merges, splits and review burden", () => {
  const base: Metrics = metricsOf(counts);
  for (const k of ["falseOpportunities", "wrongMerges", "journeysSplit", "reviewItems", "opportunitiesMergingJourneys"]) {
    assert.ok(LOWER_IS_BETTER.has(k));
    assert.equal(compare(base, { ...base, [k]: base[k] + 10 }, "x", tol).length, 1, k);
    assert.deepEqual(compare(base, { ...base, [k]: Math.max(0, base[k] - 1) }, "x", tol), [], `${k} improving`);
  }
  assert.deepEqual(compare(base, { ...base, falseOpportunities: base.falseOpportunities + 1 }, "x", tol), [], "one extra within the floor");
});

test("DECISION-LOGIC GATE: cached replay of every development fixture does not regress against eval/baseline.json", () => {
  const r = spawnSync(process.execPath, ["--no-warnings", "--import", "./scripts/loader/register.mjs", "scripts/eval-gate.ts"], { cwd: process.cwd(), encoding: "utf8", timeout: 240_000 });
  assert.equal(r.status, 0, `eval gate failed (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
});

test("the gate reports a regression (exit 1) when the baseline is better than the code", () => {
  // The pre-regression reference is better than the current code on the same frozen data, so the gate must refuse the comparison.
  const r = spawnSync(process.execPath, ["--no-warnings", "--import", "./scripts/loader/register.mjs", "scripts/eval-gate.ts", "--baseline", "eval/reference-8ee0e95.json"], { cwd: process.cwd(), encoding: "utf8", timeout: 240_000 });
  assert.equal(r.status, 1, `expected a regression exit\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /REGRESSION/);
});
