import assert from "node:assert/strict";
import test from "node:test";
import { FROZEN } from "./frozen.ts";
import { PLANNING, feasibility, improvementPower, minimumN, powerAtLeast, powerAtMost, requirements } from "./power.ts";

test("the frozen minimum-evidence numbers are exactly what the power analysis computes from the frozen design", () => {
  const r = requirements();
  assert.deepEqual(
    { recallPositives: r.recallPositives, precisionDecisions: r.precisionDecisions, typeDecisions: r.typeDecisions, agreementRows: r.agreementRows, reviewReads: r.reviewReads },
    FROZEN.minimumEvidence,
    "if this fails, the claims or design changed: re-derive and re-freeze (and start a new protocol)",
  );
});

test("power behaves sensibly: it grows with n, and a system at the target cannot be supported", () => {
  const c = FROZEN.claims.precision;
  assert.ok(powerAtLeast(20, 0.9, c.target, c.lowerMin) < powerAtLeast(60, 0.9, c.target, c.lowerMin));
  // Operating characteristic of the convention (point >= 80% AND lower bound >= 70%): a system whose true rate is exactly 80%
  // is supported about half the time at large n; one clearly below it essentially never is.
  const atTarget = powerAtLeast(400, 0.8, c.target, c.lowerMin);
  assert.ok(atTarget > 0.4 && atTarget < 0.6, `at the target: ${atTarget}`);
  assert.ok(powerAtLeast(400, 0.75, c.target, c.lowerMin) < 0.03, "a true 75% is rarely supported even with lots of evidence");
  assert.ok(powerAtLeast(300, 0.7, c.target, c.lowerMin) < 0.001, "a true rate at the floor is essentially never supported");
  const e = FROZEN.claims.agreementError;
  assert.ok(powerAtMost(100, 0.01, e.target, e.upperMax) < powerAtMost(400, 0.01, e.target, e.upperMax));
  assert.ok(powerAtMost(400, 0.05, e.target, e.upperMax) < 0.01, "a true error of 5% is essentially never supported");
});

test("the false-support rate is controlled: a system below the floor is declared supported under 2.5% of the time at every size", () => {
  const c = FROZEN.claims.strictRecall;
  for (let n = 10; n <= 400; n += 10) assert.ok(powerAtLeast(n, 0.69, c.target, c.lowerMin) < 0.025, `n=${n}`);
});

test("the improvement requirement is the binding one, and 80% power really is reached there but not far below", () => {
  const n = FROZEN.minimumEvidence.recallPositives;
  assert.ok(improvementPower(n, FROZEN.powerDesign.paired, 300, 400, 1) >= FROZEN.powerDesign.power);
  assert.ok(improvementPower(Math.floor(n / 2), FROZEN.powerDesign.paired, 300, 400, 1) < FROZEN.powerDesign.power);
  assert.ok(requirements().detail.improvementAlone! > (requirements().detail.strictRecallAlone ?? 0), "improvement needs more evidence than the absolute recall claim");
});

test("minimumN requires power to hold for the following sizes, not just a lucky first crossing", () => {
  const spiky = (n: number) => (n === 40 ? 0.9 : n >= 60 ? 0.9 : 0.1);
  assert.equal(minimumN(spiky, 0.8, 200, 25), 60);
  assert.equal(minimumN(() => 0.1, 0.8, 100), null);
});

test("feasibility is transparent: at plausible prevalence the evidence may not arrive in time, and that means inconclusive", () => {
  const low = feasibility(0.01), high = feasibility(0.1);
  assert.equal(low.reachesInTime, false);
  assert.equal(high.reachesInTime, true);
  assert.ok(low.weeksToRequirement > PLANNING.weeks);
  assert.ok(feasibility(0.03).expectedEffectiveByEnd < FROZEN.minimumEvidence.recallPositives);
});
