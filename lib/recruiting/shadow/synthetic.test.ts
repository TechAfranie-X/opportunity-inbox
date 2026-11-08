import assert from "node:assert/strict";
import test from "node:test";
import { FROZEN } from "./frozen.ts";
import { classify } from "./labelset.ts";
import { SYNTHETIC_PREFIX, assertAllReal, assertAllSynthetic, ingestionFactsOf, runSyntheticPipeline, type SyntheticParams } from "./synthetic.ts";

const P = (over: Partial<SyntheticParams> = {}): SyntheticParams => ({ factSeed: 11, readerSeed: 22, weeks: 15, weeklyPerMailbox: 60, prevalence: 0.06, quality: "good", ...over });
const key = (r: ReturnType<typeof runSyntheticPipeline>) => r.selected.map((s) => `${s.gmailMessageId}:${s.stratum}:${s.weight}`).join("|");

test("the synthetic workflow is deterministic", () => {
  assert.equal(key(runSyntheticPipeline(P())), key(runSyntheticPipeline(P())));
  assert.deepEqual(runSyntheticPipeline(P()).analysis.decision, runSyntheticPipeline(P()).analysis.decision);
});

test("LEAKAGE (end to end): the same arrivals with different reader behavior select exactly the same messages for labeling", () => {
  const a = runSyntheticPipeline(P({ readerSeed: 1, quality: "good" }));
  const b = runSyntheticPipeline(P({ readerSeed: 999, quality: "poor" }));
  const c = runSyntheticPipeline(P({ readerSeed: 5, quality: "marginal" }));
  assert.equal(key(a), key(b));
  assert.equal(key(a), key(c));
  assert.notDeepEqual(a.records.map((r) => r.state), b.records.map((r) => r.state), "the readers really did behave differently");
  assert.ok(a.selected.length > 300);
});

test("only prospective-eligible messages are ever selected, and only by their ingestion facts", () => {
  const r = runSyntheticPipeline(P({ weeks: 14 })); // stays inside the eligibility window
  const cutoff = new Date(FROZEN.cutoff).getTime();
  for (const s of r.selected) {
    assert.ok(s.arrivedAt.getTime() >= cutoff && s.arrivedAt.getTime() < new Date(FROZEN.eligibleThrough).getTime());
    assert.ok(s.gmailMessageId.startsWith(SYNTHETIC_PREFIX));
  }
  for (const rec of r.records) {
    const c = classify(ingestionFactsOf(rec));
    assert.equal(c.eligible && c.stratum === "S1", rec.isCandidate && rec.plannedRead);
  }
  assert.ok(r.selected.every((s) => (s.stratum === "S1" ? s.weight === 1 : s.weight === FROZEN.s2Weight)));
});

test("every sampling-arm message outside the census is selected as S2 (nothing dropped, nothing added)", () => {
  const r = runSyntheticPipeline(P({ weeks: 14, weeklyPerMailbox: 200 }));
  const s2 = r.selected.filter((s) => s.stratum === "S2").length;
  const nonCensusRecorded = r.records.filter((x) => !(x.isCandidate && x.plannedRead));
  const armShare = nonCensusRecorded.filter((x) => x.uniformArm).length;
  assert.equal(s2, armShare);
  assert.ok(r.population.nonCandidateArmRows > 0);
});

test("mail arriving after the window end is excluded, so late arrivals cannot enter the evidence", () => {
  const r = runSyntheticPipeline(P({ weeks: 16 }));
  const end = new Date(FROZEN.eligibleThrough).getTime();
  assert.ok(r.records.some((x) => x.arrivedAt.getTime() >= end), "the fixture does generate late mail");
  assert.ok(r.selected.every((s) => s.arrivedAt.getTime() < end));
});

test("a good system at sufficient volume is SUPPORTED, a marginal one is not, a poor one is NOT SUPPORTED", () => {
  const good = runSyntheticPipeline(P({ quality: "good" }));
  assert.equal(good.analysis.decision.overall, "supported", JSON.stringify(good.analysis.decision) + JSON.stringify(good.analysis.claims.map((c) => [c.id, c.verdict, +c.estimate.toFixed(3), +c.lo.toFixed(3), c.evidenceMet])));
  const poor = runSyntheticPipeline(P({ quality: "poor" }));
  assert.equal(poor.analysis.decision.overall, "not_supported");
  const marginal = runSyntheticPipeline(P({ quality: "marginal" }));
  assert.notEqual(marginal.analysis.decision.overall, "supported");
});

test("borderline data is INCONCLUSIVE even for a good system when clustering leaves too few effective positives", () => {
  const r = runSyntheticPipeline(P({ weeklyPerMailbox: 55, prevalence: 0.05 }));
  const recall = r.analysis.claims.find((c) => c.id === "strictRecall")!;
  assert.ok(r.analysis.counts.positives > FROZEN.minimumEvidence.recallPositives, "plenty of raw positives...");
  assert.ok(recall.effectiveN < recall.requiredN, "...but fewer effective ones, because hiring processes cluster");
  assert.equal(r.analysis.decision.overall, "inconclusive");
});

test("too little data is INCONCLUSIVE even for a good system: the minimum evidence is enforced", () => {
  const thin = runSyntheticPipeline(P({ weeks: 3, weeklyPerMailbox: 40 }));
  assert.equal(thin.analysis.decision.overall, "inconclusive");
  assert.ok(thin.analysis.claims.some((c) => !c.evidenceMet));
});

test("a poor system with too little data is not declared failed: evidence-less verdicts are descriptive", () => {
  const thin = runSyntheticPipeline(P({ weeks: 2, weeklyPerMailbox: 30, quality: "poor" }));
  assert.notEqual(thin.analysis.decision.overall, "supported");
});

test("positives cluster by hiring process across threads (the heavy tail is real in the fixture)", () => {
  const r = runSyntheticPipeline(P());
  assert.ok(r.analysis.counts.positiveClusters < r.analysis.counts.positives, "some positives share a hiring process");
});

test("fixtures and real evidence cannot be mixed", () => {
  const r = runSyntheticPipeline(P({ weeks: 4 }));
  assert.throws(() => assertAllReal(r.rows), /synthetic fixture rows/);
  assert.doesNotThrow(() => assertAllSynthetic(r.rows));
  assert.doesNotThrow(() => assertAllReal([{ messageId: "18c0ffee", mailbox: "10396454" }]));
  assert.throws(() => assertAllSynthetic([{ messageId: "18c0ffee", mailbox: "10396454" }]), /not fixtures/);
});

test("the planted ground truth reaches the analysis intact (labels are exactly the truth)", () => {
  const r = runSyntheticPipeline(P({ weeks: 6 }));
  for (const row of r.rows) assert.equal(row.label.positive, r.truth.get(row.messageId)!.positive);
});
