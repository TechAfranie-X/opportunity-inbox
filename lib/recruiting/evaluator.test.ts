import assert from "node:assert/strict";
import test from "node:test";
import { correctionRate, evaluate, formatReport, rate, resolveLabels, type EvalInput, type LabelRow } from "./evaluator.ts";
import type { LabelField, LabelSource } from "./ground-truth.ts";
import type { Prediction } from "./predictions.ts";

const T0 = new Date("2026-03-01T00:00:00Z");
const lab = (id: string, field: LabelField, value: unknown, source: LabelSource = "dev_human", at = T0): LabelRow => ({ gmailMessageId: id, field, value, source, createdAt: at });

const pred = (id: string, thread: string, o: Partial<Prediction> = {}): Prediction => ({
  gmailMessageId: id, gmailThreadId: thread, extractorVersion: "test", decision: "recruiting", outbound: false, senderDomain: "x.com",
  type: null, company: null, role: null, eventDate: null, dateKind: null, confidence: 0.9, fieldConfidence: null, signals: [], reviewReasons: [], ...o,
});

// A small world whose every metric is worked out by hand in the assertions below.
const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"];
const labels: LabelRow[] = [
  lab("m1", "is_recruiting", true), lab("m1", "type", "assessment"), lab("m1", "company", "Acme"), lab("m1", "role", "Software Engineer Intern"), lab("m1", "opportunity_ref", "A"), lab("m1", "event_date", "2026-03-05"), lab("m1", "urgency", "today"),
  lab("m2", "is_recruiting", true), lab("m2", "type", "applied"), lab("m2", "company", "Beta"), lab("m2", "role", "not_applicable"), lab("m2", "opportunity_ref", "B"), lab("m2", "event_date", "not_applicable"),
  lab("m3", "is_recruiting", true), lab("m3", "type", "rejection"), lab("m3", "company", "Gamma"), lab("m3", "role", "Data Analyst"), lab("m3", "opportunity_ref", "C"), lab("m3", "urgency", "none"),
  lab("m4", "is_recruiting", true), lab("m4", "type", "interview_scheduled"), lab("m4", "company", "Acme"), lab("m4", "role", "Software Engineer Intern"), lab("m4", "opportunity_ref", "A"), lab("m4", "event_date", "not_applicable"),
  lab("m5", "is_recruiting", false),
  lab("m6", "is_recruiting", false),
  lab("m7", "is_recruiting", true), lab("m7", "type", "offer"), lab("m7", "company", "unknown"), lab("m7", "opportunity_ref", "D"), lab("m7", "urgency", "today"),
  lab("m8", "is_recruiting", true), lab("m8", "type", "follow_up"), lab("m8", "company", "Delta"), lab("m8", "role", "unknown"), lab("m8", "opportunity_ref", "E"), lab("m8", "urgency", "soon"),
  // m9 is deliberately unlabeled
];
const predictions: Prediction[] = [
  pred("m1", "t1", { type: "assessment", company: "Acme", role: "Software Engineer Intern", eventDate: new Date("2026-03-05T00:00:00Z") }),
  pred("m2", "t2", { type: "applied", company: "Beta Inc", eventDate: new Date("2026-04-01T00:00:00Z") }),
  pred("m3", "t3", { type: "status_update", company: "Gamma", role: "Analyst", confidence: 0.85 }),
  pred("m4", "t4", { type: "interview_scheduled", company: "Acme", role: "Software Engineer Intern" }),
  pred("m5", "t5", { decision: "not_recruiting", confidence: null }),
  pred("m6", "t6", { type: "applied", company: "Shop", confidence: 0.7 }),
  // m7 has no prediction at all: a missed email that was never scanned
  pred("m8", "t8", { type: "follow_up", company: null, confidence: 0.4 }),
  pred("m9", "t9", { type: "applied", company: "Zed" }),
];
const input: EvalInput = {
  kind: "dev_random", datasetName: "t", asOf: T0, messageIds: ids, labels, predictions,
  threadOf: new Map(ids.map((i) => [i, `t${i.slice(1)}`])),
  predictedGroups: new Map([["m1", "g1"], ["m4", "g1"], ["m2", "g2"], ["m3", "g2"], ["m8", "g3"]]),
  predictedTodayThreads: new Set(["t1", "t3", "t6"]),
  thresholds: [0, 0.8],
};
const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("recruiting precision, recall and F1 (hand-computed: tp5 fp1 fn1 tn1)", () => {
  const r = evaluate(input);
  assert.deepEqual([r.recruiting.tp, r.recruiting.fp, r.recruiting.fn, r.recruiting.tn], [5, 1, 1, 1]);
  near(r.recruiting.precision.value, 5 / 6);
  near(r.recruiting.recall.value, 5 / 6);
  near(r.recruiting.f1, 5 / 6);
  assert.equal(r.coverage.unlabeled, 1); // m9
  assert.equal(r.coverage.unpredicted, 1); // m7
});

test("type accuracy excludes unlabeled and counts a missed email as wrong; confident-wrong is separate", () => {
  const r = evaluate(input);
  assert.deepEqual([r.type.accuracy.k, r.type.accuracy.n], [4, 6]); // m3 and m7 wrong
  assert.deepEqual([r.type.accuracyWhenDetected.k, r.type.accuracyWhenDetected.n], [4, 5]);
  assert.deepEqual([r.type.confidentWrong.k, r.type.confidentWrong.n], [1, 4]); // m3 shown confidently; m8 was flagged for review
});

test("company: exact vs normalized, unknown labels excluded, abstention counted as wrong but not confident-wrong", () => {
  const r = evaluate(input);
  assert.equal(r.company.unknownLabels, 1); // m7
  assert.deepEqual([r.company.exact.k, r.company.exact.n], [3, 5]); // "Beta Inc" and null miss
  assert.deepEqual([r.company.normalized.k, r.company.normalized.n], [4, 5]); // "Beta Inc" ~ "Beta"
  assert.deepEqual([r.company.abstained.k, r.company.abstained.n], [1, 5]);
  assert.deepEqual([r.company.confidentWrong.k, r.company.confidentWrong.n], [0, 4]);
});

test("role: not_applicable rewards predicting none; unknown is excluded; lenient vs exact", () => {
  const r = evaluate(input);
  assert.equal(r.role.unknownLabels, 1);
  assert.deepEqual([r.role.accuracy.k, r.role.accuracy.n], [4, 4]);
  assert.deepEqual([r.role.exact.k, r.role.exact.n], [3, 4]); // "Analyst" is not exactly "Data Analyst"
});

test("date accuracy at day granularity, including not_applicable", () => {
  const r = evaluate(input);
  assert.deepEqual([r.date.accuracy.k, r.date.accuracy.n], [2, 3]); // m2 predicted a date it should not have
});

test("grouping: pairwise precision, recall and F1 (one true pair, two predicted pairs)", () => {
  const r = evaluate(input);
  assert.deepEqual([r.grouping.truePairs, r.grouping.predictedPairs], [1, 2]);
  near(r.grouping.precision.value, 0.5);
  near(r.grouping.recall.value, 1);
  near(r.grouping.f1, 2 / 3);
});

test("today precision judges only labeled threads; recall counts an unscanned urgent thread as missed", () => {
  const r = evaluate(input);
  assert.deepEqual([r.today.precision.k, r.today.precision.n], [1, 2]); // t6 unlabeled -> not judged
  assert.deepEqual([r.today.recall.k, r.today.recall.n], [1, 2]); // t7 urgent but never predicted
});

test("abstention and the risk-coverage sweep", () => {
  const r = evaluate(input);
  assert.deepEqual([r.abstention.reviewRate.k, r.abstention.reviewRate.n], [1, 7]);
  assert.deepEqual([r.abstention.unknownCompanyRate.k, r.abstention.unknownCompanyRate.n], [1, 7]);
  const [t0, t8] = r.riskCoverage;
  assert.deepEqual([t0.coverage.k, t0.coverage.n, t0.typeAccuracy.k, t0.typeAccuracy.n, t0.companyAccuracy.k, t0.companyAccuracy.n], [5, 5, 4, 5, 4, 5]);
  assert.deepEqual([t8.coverage.k, t8.coverage.n, t8.typeAccuracy.k, t8.typeAccuracy.n, t8.companyAccuracy.k, t8.companyAccuracy.n], [4, 5, 3, 4, 4, 4]);
});

test("a stricter policy withholds low-confidence values, trading coverage for fewer wrong answers", () => {
  const strict = evaluate({ ...input, policy: { reviewBelow: 0.6, unknownBelow: 0.88 } });
  // m3 (0.85) is now withheld instead of shown confidently wrong; m6/m8 too
  assert.equal(strict.type.confidentWrong.k, 0);
  assert.ok(strict.type.accuracy.k < 4 || strict.company.abstained.k > 1);
});

test("provenance: legacy and correction labels never count toward DEV-RANDOM or BLIND headline metrics", () => {
  const legacy = [...labels, lab("m5", "is_recruiting", true, "legacy_reconstructed", new Date("2027-01-01")), lab("m6", "company", "X", "user_correction")];
  const r = evaluate({ ...input, labels: legacy });
  assert.deepEqual(r.excludedLabelRows, { legacy_reconstructed: 1, user_correction: 1 });
  assert.deepEqual(r.recruiting, evaluate(input).recruiting); // unchanged by the excluded rows
  assert.throws(() => evaluate({ ...input, sources: ["dev_human", "legacy_reconstructed"] }), /DEV-CHALLENGE/);
  assert.throws(() => evaluate({ ...input, kind: "blind", sources: ["user_correction"] }), /headline metrics/);
  const challenge = evaluate({ ...input, kind: "dev_challenge", labels: legacy });
  assert.ok(challenge.labelSources.includes("legacy_reconstructed"));
  assert.match(challenge.banner, /NEVER a generalisation estimate/);
});

test("append-only relabeling: the latest label wins, by time then by order", () => {
  const rows = [lab("a", "company", "Old", "dev_human", new Date("2026-01-01")), lab("a", "company", "New", "dev_human", new Date("2026-02-01")), lab("b", "company", "X"), lab("b", "company", "Y")];
  const m = resolveLabels(rows, ["dev_human"]);
  assert.equal(m.get("a")?.company, "New");
  assert.equal(m.get("b")?.company, "Y");
});

test("labels outside the frozen membership are ignored", () => {
  const r = evaluate({ ...input, labels: [...labels, lab("zzz", "is_recruiting", true)] });
  assert.equal(r.coverage.messages, 9);
  assert.deepEqual(r.recruiting.tp, 5);
});

test("the evaluator is deterministic", () => {
  assert.equal(JSON.stringify(evaluate(input)), JSON.stringify(evaluate({ ...input, messageIds: [...ids].reverse() })));
});

test("two predictions for one message are rejected (evaluate one extractor version at a time)", () => {
  assert.throws(() => evaluate({ ...input, predictions: [...predictions, pred("m1", "t1")] }), /more than one prediction/);
});

test("BLIND: a non-official run is marked contaminated in the banner and the report", () => {
  const ok = evaluate({ ...input, kind: "blind", official: true });
  const bad = evaluate({ ...input, kind: "blind", official: false });
  assert.equal(ok.official, true);
  assert.equal(bad.official, false);
  assert.match(bad.banner, /^CONTAMINATED/);
  assert.match(formatReport(bad), /CONTAMINATED RUN/);
  assert.match(formatReport(evaluate(input)), /^DEV-RANDOM/);
});

test("Wilson interval is honest about small samples", () => {
  assert.equal(rate(0, 0).value, null);
  const r = rate(5, 10);
  assert.ok(r.ci![0] < 0.5 && r.ci![1] > 0.5);
  assert.ok(rate(10, 10).ci![0] < 0.75); // 10/10 is not "certainly 100%"
  assert.equal(rate(10, 10).ci![1], 1);
});

test("correction rate counts corrected shown predictions, ignoring other sources", () => {
  const corr = [lab("m1", "company", "A", "user_correction"), lab("m1", "type", "offer", "user_correction"), lab("m2", "company", "B", "dev_human")];
  const r = correctionRate(["m1", "m2", "m3", "m4"], corr);
  assert.deepEqual([r.k, r.n], [1, 4]);
});

test("naming an employer the labeler could not is counted as overreach; the label set has a stable fingerprint", () => {
  const withOver = evaluate({ ...input, predictions: [...predictions.filter((p) => p.gmailMessageId !== "m7"), pred("m7", "t7", { type: "offer", company: "Invented Inc" })] });
  assert.deepEqual([withOver.company.overreach.k, withOver.company.overreach.n], [1, 1]);
  assert.deepEqual([evaluate(input).company.overreach.k, evaluate(input).company.overreach.n], [0, 1]); // m7 has no prediction: nothing was named
  const a = evaluate(input).labelSetHash;
  assert.equal(evaluate({ ...input, labels: [...labels].reverse() }).labelSetHash, a); // order-independent
  assert.notEqual(evaluate({ ...input, labels: [...labels, lab("m9", "is_recruiting", false, "dev_human", new Date("2026-03-02T00:00:00Z"))] }).labelSetHash, a);
  assert.match(formatReport(evaluate(input)), /label set [0-9a-f]{16}/);
});
