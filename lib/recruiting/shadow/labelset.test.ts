import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FROZEN } from "./frozen.ts";
import { INGESTION_COLUMNS, classify, isoWeek, selectLabelSet, type IngestionFacts } from "./labelset.ts";
import { uniformArm } from "./shadow.ts";

const facts = (over: Partial<IngestionFacts> = {}): IngestionFacts => ({
  userGoogleSub: "u1", gmailMessageId: "m1", gmailThreadId: "t1", arrivedAt: new Date(new Date(FROZEN.cutoff).getTime() + 9.5 * 86400000),
  readerVersion: FROZEN.readerVersion, pipelineVersion: FROZEN.pipelineVersion, extractorVersion: FROZEN.extractorVersion,
  cohort: "prospective", uniformArm: false, isCandidate: true, plannedRead: true, ...over,
});

test("S1 is every planned candidate (weight 1); S2 is the sampling arm (weight 1 / rate); everything else is unlabeled", () => {
  assert.deepEqual(classify(facts()), { eligible: true, stratum: "S1", weight: 1 });
  assert.deepEqual(classify(facts({ isCandidate: false, plannedRead: false, uniformArm: true })), { eligible: true, stratum: "S2", weight: 4 });
  assert.deepEqual(classify(facts({ plannedRead: false, uniformArm: true })), { eligible: true, stratum: "S2", weight: 4 }, "a vetoed candidate in the arm is S2");
  assert.deepEqual(classify(facts({ isCandidate: false, plannedRead: false })), { eligible: false, reason: "not_in_label_set" });
  assert.deepEqual(classify(facts({ plannedRead: false })), { eligible: false, reason: "not_in_label_set" });
  assert.equal(FROZEN.s2Weight, 1 / FROZEN.uniformRate, "the S2 weight is the inverse of the sampling rate");
});

test("a planned candidate in the arm is S1, never double counted as S2", () => {
  assert.equal(selectLabelSet([facts({ uniformArm: true })]).length, 1);
  assert.equal(selectLabelSet([facts({ uniformArm: true })])[0].stratum, "S1");
});

test("eligibility boundaries: the cutoff is inclusive, the window end is exclusive, other versions and inconsistent cohorts never qualify", () => {
  assert.equal(classify(facts({ arrivedAt: new Date(FROZEN.cutoff) })).eligible, true);
  assert.deepEqual(classify(facts({ arrivedAt: new Date(new Date(FROZEN.cutoff).getTime() - 1) })), { eligible: false, reason: "before_cutoff" });
  assert.equal(classify(facts({ arrivedAt: new Date(new Date(FROZEN.eligibleThrough).getTime() - 1) })).eligible, true);
  assert.deepEqual(classify(facts({ arrivedAt: new Date(FROZEN.eligibleThrough) })), { eligible: false, reason: "after_window" });
  assert.deepEqual(classify(facts({ readerVersion: "reader-s1-gother" })), { eligible: false, reason: "frozen_version_mismatch" });
  assert.deepEqual(classify(facts({ pipelineVersion: "arch-v9" })), { eligible: false, reason: "frozen_version_mismatch" });
  assert.deepEqual(classify(facts({ extractorVersion: "2027.1" })), { eligible: false, reason: "frozen_version_mismatch" });
  assert.deepEqual(classify(facts({ cohort: "historical" })), { eligible: false, reason: "cohort_inconsistent" });
});

test("historical mail can never be selected, whatever else is true of it", () => {
  const old = facts({ arrivedAt: new Date(new Date(FROZEN.cutoff).getTime() - 1000), cohort: "historical", uniformArm: true });
  assert.equal(selectLabelSet([old, { ...old, cohort: "prospective" }]).length, 0);
});

test("LEAKAGE: selection reads only ingestion facts; touching any reader output throws", () => {
  const allowed = new Set<string>(INGESTION_COLUMNS);
  const spy = (extra: Record<string, unknown>) => new Proxy({ ...facts(), ...extra } as Record<string, unknown>, {
    get(t, k) {
      if (typeof k === "string" && !allowed.has(k)) throw new Error(`selection touched non-ingestion field "${k}"`);
      return t[k as string];
    },
  }) as unknown as IngestionFacts;
  const readerOutputs = { rulesRecruiting: true, rulesType: "applied", modelRecruiting: false, modelStatus: "ok", state: "review", reviewReason: "reader_disagreement", modelSuggests: "recruiting", finalType: "offer", finalCompany: "X", legacyQueryMatch: true };
  assert.doesNotThrow(() => selectLabelSet([spy(readerOutputs), spy({}), spy({ isCandidate: false, plannedRead: false, uniformArm: true })]));
  // A selector that read an output would throw above; prove the spy itself works:
  assert.throws(() => (spy(readerOutputs) as unknown as { state: string }).state, /non-ingestion field "state"/);
});

test("LEAKAGE: selection is identical whatever the readers said", () => {
  const base = Array.from({ length: 200 }, (_, i) => facts({ gmailMessageId: `m${i}`, gmailThreadId: `t${i}`, isCandidate: i % 3 !== 0, plannedRead: i % 5 !== 0, uniformArm: uniformArm("u1", `m${i}`, FROZEN.uniformRate) }));
  const withOutputs = (variant: number) => base.map((f, i) => ({ ...f, rulesRecruiting: (i + variant) % 2 === 0, state: ["recruiting", "not_recruiting", "review"][(i + variant) % 3], modelSuggests: variant ? "recruiting" : null })) as IngestionFacts[];
  const ids = (rows: IngestionFacts[]) => selectLabelSet(rows).map((s) => `${s.gmailMessageId}:${s.stratum}`).join(",");
  assert.equal(ids(withOutputs(0)), ids(withOutputs(1)));
  assert.equal(ids(withOutputs(1)), ids(base));
});

test("LEAKAGE: the module's source never names a reader output, and the CLI query selects only ingestion columns", () => {
  const src = readFileSync(new URL("./labelset.ts", import.meta.url), "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["rulesRecruiting", "rulesType", "rulesCompany", "rulesRole", "modelRecruiting", "modelStatus", "modelSuggests", "reviewReason", "finalType", "finalCompany", "finalRole", "legacyQueryMatch", ".state", "typeReview"]) {
    assert.ok(!src.includes(forbidden), `labelset.ts must not reference ${forbidden}`);
  }
  assert.deepEqual([...INGESTION_COLUMNS].sort(), ["arrivedAt", "cohort", "extractorVersion", "gmailMessageId", "gmailThreadId", "isCandidate", "pipelineVersion", "plannedRead", "readerVersion", "uniformArm", "userGoogleSub"]);
});

test("the sampling arm is deterministic, near the frozen rate, and monotone, so S2 cannot depend on content", () => {
  let hits = 0;
  const N = 20000;
  for (let i = 0; i < N; i += 1) if (uniformArm("user-x", `msg-${i}`, FROZEN.uniformRate)) hits += 1;
  assert.ok(Math.abs(hits / N - FROZEN.uniformRate) < 0.01, `rate ${hits / N}`);
  for (let i = 0; i < 300; i += 1) assert.equal(uniformArm("user-x", `m${i}`, FROZEN.uniformRate), uniformArm("user-x", `m${i}`, FROZEN.uniformRate));
});

test("ISO week names are stable across year boundaries", () => {
  assert.equal(isoWeek(new Date("2026-12-01T00:00:00Z")), "2026w49");
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026w53");
  assert.equal(isoWeek(new Date("2027-03-14T23:59:59Z")), "2027w10");
  assert.equal(isoWeek(new Date("2027-03-15T00:00:00Z")), "2027w11");
});
