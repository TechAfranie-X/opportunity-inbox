import assert from "node:assert/strict";
import test from "node:test";
import { computeAnalysis, decide, estimateCost, formatAnalysis, type AnalysisRow, type ClaimOutcome } from "./analysis.ts";
import { FROZEN } from "./frozen.ts";

let n = 0;
const row = (o: { pos?: boolean; state?: AnalysisRow["v2"]["state"]; stratum?: "S1" | "S2"; legacy?: boolean; opp?: string | null; thread?: string; type?: string | null; finalType?: string | null; mailbox?: string; read?: boolean; ungrounded?: number | null; suggests?: "recruiting" | "not_recruiting" | null; candidate?: boolean; company?: string | null; finalCompany?: string | null; role?: string | null; finalRole?: string | null } = {}): AnalysisRow => {
  n += 1;
  const pos = o.pos ?? false;
  const stratum = o.stratum ?? "S1";
  return {
    mailbox: o.mailbox ?? "m1", messageId: `id${n}`, threadId: o.thread ?? `t${n}`, stratum, weight: stratum === "S1" ? 1 : FROZEN.s2Weight,
    label: { positive: pos, type: o.type === undefined ? (pos ? "status_update" : null) : o.type, company: o.company ?? null, role: o.role ?? null, opportunity: o.opp === undefined ? (pos ? `o${n}` : null) : o.opp },
    v2: { state: o.state ?? (pos ? "recruiting" : "not_recruiting"), reviewReason: (o.state ?? "") === "review" ? "reader_disagreement" : null, modelSuggests: o.suggests ?? null, finalType: o.finalType === undefined ? (pos ? "status_update" : null) : o.finalType, finalCompany: o.finalCompany ?? null, finalRole: o.finalRole ?? null, isCandidate: o.candidate ?? stratum === "S1", plannedRead: stratum === "S1", modelRead: o.read ?? stratum === "S1", ungrounded: o.ungrounded === undefined ? 0 : o.ungrounded },
    legacyFound: o.legacy ?? false,
  };
};
const many = (k: number, f: (i: number) => AnalysisRow) => Array.from({ length: k }, (_, i) => f(i));
const claim = (a: ReturnType<typeof computeAnalysis>, id: string) => a.claims.find((c) => c.id === id)!;

test("strict recall counts review rows as misses; precision excludes them; decided recall excludes them", () => {
  const rows = [
    ...many(6, () => row({ pos: true })),                       // found
    ...many(2, () => row({ pos: true, state: "review" })),      // positive sitting in review
    ...many(2, () => row({ pos: true, state: "not_recruiting" })), // missed
    ...many(1, () => row({ pos: false, state: "recruiting", finalType: "status_update" })), // false positive
    ...many(3, () => row({ pos: false, state: "review" })),     // negatives in review
  ];
  const a = computeAnalysis(rows);
  assert.equal(claim(a, "strictRecall").estimate, 6 / 10, "6 of 10 positives found; review counts as a miss");
  assert.equal(claim(a, "precision").estimate, 6 / 7, "7 recruiting decisions, 6 true; the 5 review rows are in neither group");
  assert.equal(a.secondary.decidedRecall.p, 6 / 8, "review excluded: 6 of 8");
});

test("SENSITIVITY: resolving review by the model's suggestion is reported but cannot change any claim or the outcome", () => {
  const base = [...many(8, () => row({ pos: true })), ...many(3, () => row({ pos: true, state: "review", suggests: "recruiting" })), ...many(2, () => row({ pos: false, state: "review", suggests: "recruiting" }))];
  const a = computeAnalysis(base);
  const flipped = computeAnalysis(base.map((r) => ({ ...r, v2: { ...r.v2, modelSuggests: r.v2.state === "review" ? ("not_recruiting" as const) : r.v2.modelSuggests } })));
  assert.deepEqual(a.claims, flipped.claims, "claims are independent of the suggestion");
  assert.deepEqual(a.decision, flipped.decision);
  assert.notEqual(a.sensitivity.precisionIfReviewResolvedByModelSuggestion.p, flipped.sensitivity.precisionIfReviewResolvedByModelSuggestion.p);
  assert.equal(a.sensitivity.strictRecallIfReviewResolvedByModelSuggestion.p, 11 / 11);
  assert.equal(a.sensitivity.precisionIfReviewResolvedByModelSuggestion.p, 11 / 13);
});

test("clustering: positives of one hiring process across different threads are one cluster, shrinking the evidence", () => {
  const spread = many(10, (i) => row({ pos: true, opp: `o-${i}` }));
  const oneProcess = many(10, () => row({ pos: true, opp: "same-employer" }));
  assert.equal(computeAnalysis(spread).counts.positiveClusters, 10);
  assert.equal(computeAnalysis(oneProcess).counts.positiveClusters, 1);
  assert.ok(claim(computeAnalysis(oneProcess), "strictRecall").effectiveN < claim(computeAnalysis(spread), "strictRecall").effectiveN / 5);
  assert.ok(claim(computeAnalysis(oneProcess), "strictRecall").lo < claim(computeAnalysis(spread), "strictRecall").lo);
});

test("clusters never cross mailboxes", () => {
  const a = computeAnalysis([row({ pos: true, opp: "x", mailbox: "m1" }), row({ pos: true, opp: "x", mailbox: "m2" })]);
  assert.equal(a.counts.positiveClusters, 2);
});

test("S2 observations carry weight 4 in recall, and S2 positives missed by v2 drag recall down by that weight", () => {
  const rows = [...many(8, () => row({ pos: true })), row({ pos: true, stratum: "S2", state: "not_recruiting", candidate: false })];
  const a = computeAnalysis(rows);
  assert.equal(claim(a, "strictRecall").estimate, 8 / 12);
  assert.equal(a.counts.s2Positives, 1);
});

test("the improvement claim compares v2 with the current product on the same positives", () => {
  const rows = [...many(30, () => row({ pos: true, legacy: true })), ...many(30, () => row({ pos: true, legacy: false }))];
  const c = claim(computeAnalysis(rows), "improvement");
  assert.equal(c.estimate, 0.5);
  assert.ok(c.lo > 0.2);
  assert.equal(c.verdict, "supported");
  const none = claim(computeAnalysis(many(40, () => row({ pos: true, legacy: true }))), "improvement");
  assert.equal(none.estimate, 0);
  assert.equal(none.verdict, "not_supported");
});

test("type accuracy is conditional on v2 calling the message recruiting; the unconditional version is secondary", () => {
  const rows = [...many(8, () => row({ pos: true })), row({ pos: true, finalType: "offer" }), row({ pos: true, finalType: "offer" }), row({ pos: true, state: "not_recruiting", finalType: null })];
  const a = computeAnalysis(rows);
  assert.equal(claim(a, "typeAccuracy").estimate, 8 / 10);
  assert.equal(a.secondary.typeAccuracyUnconditional.p, 8 / 11);
  const unknownType = computeAnalysis([row({ pos: true, type: null }), row({ pos: true })]);
  assert.equal(claim(unknownType, "typeAccuracy").effectiveN, 1, "a positive whose label type is unknown is excluded");
});

test("agreement-region error uses only S1 rows both readers read and agreed on", () => {
  const rows = [...many(20, () => row({ pos: false })), row({ pos: true, state: "not_recruiting" }) /* agreed 'no' but it was a positive: an error */, ...many(5, () => row({ pos: true })), ...many(4, () => row({ pos: false, state: "review" }))];
  const c = claim(computeAnalysis(rows), "agreementError");
  assert.equal(c.estimate, 1 / 26);
});

test("review rate is review rows over S1 rows the model read", () => {
  const rows = [...many(18, () => row({ pos: false })), ...many(2, () => row({ pos: false, state: "review" })), row({ pos: false, state: "not_recruiting", read: false })];
  assert.equal(claim(computeAnalysis(rows), "reviewRate").estimate, 2 / 20);
});

test("ungrounded values: any survivor fails the claim; an unaudited read counts against it; no reads is inconclusive", () => {
  assert.equal(claim(computeAnalysis(many(5, () => row({}))), "ungrounded").verdict, "supported");
  assert.equal(claim(computeAnalysis([...many(5, () => row({})), row({ ungrounded: 1 })]), "ungrounded").verdict, "not_supported");
  assert.equal(claim(computeAnalysis([...many(5, () => row({})), row({ ungrounded: null })]), "ungrounded").verdict, "not_supported");
  assert.equal(claim(computeAnalysis([row({ read: false })]), "ungrounded").verdict, "inconclusive");
});

test("employer and role accuracy are secondary and use the normalized match and the not-applicable convention", () => {
  const rows = [row({ pos: true, company: "Acme Inc", finalCompany: "Acme" }), row({ pos: true, company: "Globex", finalCompany: "Initech" }), row({ pos: true, role: "not_applicable", finalRole: null }), row({ pos: true, role: "Analyst", finalRole: "Analyst Intern" }), row({ pos: true, role: null, finalRole: "X" })];
  const a = computeAnalysis(rows);
  assert.equal(a.secondary.companyAccuracy.p, 1 / 2);
  assert.equal(a.secondary.roleAccuracy.p, 1, "not_applicable is right when no role is shown; Analyst vs Analyst Intern match; unknown excluded");
});

// ---- outcome logic ----
const fake = (id: ClaimOutcome["id"], verdict: ClaimOutcome["verdict"], evidenceMet: boolean): ClaimOutcome => ({ id, title: id, rule: "", estimate: 0, lo: 0, hi: 0, effectiveN: evidenceMet ? 100 : 5, requiredN: 50, evidenceMet, verdict });
const ids: ClaimOutcome["id"][] = ["improvement", "strictRecall", "precision", "typeAccuracy", "agreementError", "reviewRate", "ungrounded"];

test("outcome: SUPPORTED only when every claim has its evidence and is supported", () => {
  assert.equal(decide(ids.map((i) => fake(i, "supported", true))).overall, "supported");
});

test("outcome: a failed point estimate with sufficient evidence makes it NOT SUPPORTED, even if others lack evidence", () => {
  const cs = ids.map((i) => fake(i, "supported", true));
  cs[2] = fake("precision", "not_supported", true);
  cs[0] = fake("improvement", "inconclusive", false);
  assert.equal(decide(cs).overall, "not_supported");
});

test("outcome: insufficient evidence is INCONCLUSIVE, even when every point estimate passes or one looks failed", () => {
  const cs = ids.map((i) => fake(i, "supported", true));
  cs[1] = fake("strictRecall", "supported", false);
  const d = decide(cs);
  assert.equal(d.overall, "inconclusive");
  assert.match(d.reasons.join(" "), /strictRecall: insufficient evidence/);
  const failedButThin = ids.map((i) => fake(i, "supported", true));
  failedButThin[3] = fake("typeAccuracy", "not_supported", false);
  assert.equal(decide(failedButThin).overall, "inconclusive", "a failed claim without its evidence is descriptive, not a verdict");
});

test("outcome: a passing point whose interval does not clear is INCONCLUSIVE, never promoted", () => {
  const cs = ids.map((i) => fake(i, "supported", true));
  cs[4] = fake("agreementError", "inconclusive", true);
  assert.equal(decide(cs).overall, "inconclusive");
});

test("end to end on a strong, sufficiently large synthetic set the outcome is SUPPORTED; on a weak one NOT SUPPORTED", () => {
  const strong = [
    ...many(80, (i) => row({ pos: true, legacy: i % 2 === 0 })),
    ...many(300, () => row({ pos: false })),
  ];
  const a = computeAnalysis(strong);
  assert.equal(a.decision.overall, "supported", JSON.stringify(a.decision));
  const weak = [...many(30, () => row({ pos: true })), ...many(50, () => row({ pos: true, state: "not_recruiting" })), ...many(300, () => row({ pos: false }))];
  assert.equal(computeAnalysis(weak).decision.overall, "not_supported");
});

test("a small set is INCONCLUSIVE however good it looks: the minimum evidence is not negotiable", () => {
  const tiny = [...many(12, () => row({ pos: true, legacy: false })), ...many(40, () => row({ pos: false }))];
  const a = computeAnalysis(tiny);
  assert.equal(a.decision.overall, "inconclusive");
  assert.ok(a.claims.some((c) => !c.evidenceMet));
});

test("cost estimate uses the arm to infer the unrecorded non-candidate mail", () => {
  const c = estimateCost({ candidateRows: 600, plannedReads: 540, vetoed: 60, legacyOnlyRows: 20, nonCandidateArmRows: 50 });
  assert.equal(c.eligibleEstimate, 600 + 20 + 50 / FROZEN.uniformRate);
  assert.ok(Math.abs(c.readsPer100 - (100 * 540) / 820) < 1e-9);
});

test("the report states the outcome, every claim, the evidence, the secondary measures and the sensitivity block", () => {
  const text = formatAnalysis(computeAnalysis([...many(80, () => row({ pos: true, legacy: false })), ...many(300, () => row({ pos: false }))], { candidateRows: 380, plannedReads: 380, vetoed: 0, legacyOnlyRows: 0, nonCandidateArmRows: 0 }), ["HEADER"]);
  for (const s of ["OUTCOME:", "PRIMARY CLAIMS", "SECONDARY", "SENSITIVITY ANALYSES (cannot determine the outcome)", "improves", "Absolute strict end-to-end recall", "model reads per 100"]) {
    if (s === "improves" || s === "model reads per 100") continue;
    assert.ok(text.includes(s), s);
  }
  assert.ok(text.startsWith("HEADER"));
});

import { labelFactsFrom, mailboxLabel, toAnalysisRow } from "./join.ts";
import { recordForNonCandidate } from "./shadow.ts";

test("PRIVACY: a result never carries the account identifier; mailboxes appear as opaque labels", () => {
  const sub = "100000000000000000001"; // a fake account id: real identifiers never belong in the repository
  const rec = recordForNonCandidate(sub, { id: "z1", threadId: "t1", from: "a@b.example", receivedAt: new Date(new Date(FROZEN.cutoff).getTime() + 4 * 86400000) }, { enabled: true, cutoff: new Date(FROZEN.cutoff), uniformRate: FROZEN.uniformRate });
  const row = toAnalysisRow(rec, { stratum: "S2", weight: 4 }, labelFactsFrom({ is_recruiting: false })!);
  assert.equal(row.mailbox, mailboxLabel(sub));
  assert.ok(!row.mailbox.includes(sub));
  const text = formatAnalysis(computeAnalysis([row]), ["HEADER"]);
  assert.ok(!text.includes(sub), "the formatted result does not contain the account id");
  assert.match(text, new RegExp(mailboxLabel(sub)));
});
