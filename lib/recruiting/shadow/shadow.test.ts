import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { shadowReads } from "../../db/schema.ts";
import { GUIDE_V2, READER_VERSION } from "../reader/guide.ts";
import { GUIDE_V3, READER_VERSION_V3 } from "../reader/guide3.ts";
import { STRESS_SET, stressEmail } from "../reader/stress-set.ts";
import type { VerifiedOutput } from "../reader/types.ts";
import type { RecruitingEmail } from "../types.ts";
import { readShadowConfig } from "./config.ts";
import { FROZEN } from "./frozen.ts";
import { buildShadowInput, shadowKey } from "./input.ts";
import { formatSummary, summarize, type ReportRow } from "./report.ts";
import { PIPELINE_VERSION, cohortOf, recordForCandidate, recordForLegacyOnly, recordForNonCandidate, resolveRecord, reviewItemOf, uniformArm, type ShadowConfig } from "./shadow.ts";

const CUTOFF_MS = new Date(FROZEN.cutoff).getTime();
/** An instant a given number of days after the frozen cutoff (negative: before it). Tests never restate a calendar date for a frozen parameter. */
const AT = (days: number) => new Date(CUTOFF_MS + days * 86400000);
const CFG: ShadowConfig = { enabled: true, cutoff: new Date(FROZEN.cutoff), uniformRate: FROZEN.uniformRate };
const mail = (over: Partial<RecruitingEmail> = {}): RecruitingEmail => ({ id: "m1", threadId: "t1", from: "Acme Recruiting <jobs@acme.example>", subject: "Your application to Acme", receivedAt: AT(16), outbound: false, bodyText: "Thank you for applying to the Software Engineer Intern position. We will be in touch.", ...over });
const model = (over: Partial<VerifiedOutput> = {}): VerifiedOutput => ({ key: "k", status: "ok", recruiting: true, type: "applied", stage: "applied", company: "Acme", companySource: "candidate", role: "Software Engineer Intern", dateText: null, certainty: "high", evidence: { hash: "abc123", offset: 4 }, rejections: [], ...over });

// ---- guide v3 / frozen v2 ----
test("the frozen v2 reader version is unchanged, and v3 is a different version", () => {
  assert.equal(READER_VERSION, "reader-s1-ga5cc64879982");
  assert.notEqual(READER_VERSION_V3, READER_VERSION);
  assert.match(READER_VERSION_V3, /^reader-s1-g[0-9a-f]{12}$/);
});

test("guide v3 encodes the fixed scope and leaves every other section as v2", () => {
  assert.match(GUIDE_V3, /^# Classification guide v3/);
  assert.match(GUIDE_V3, /pre-start steps that complete the hire/);
  assert.match(GUIDE_V3, /background screening requested by the employer/);
  for (const out of ["courses, bootcamps", "scholarships", "hackathons", "ALREADY started"]) assert.ok(GUIDE_V3.includes(out), `v3 should say "${out}" is not recruiting`);
  const tail = (g: string) => g.slice(g.indexOf("## Type"));
  assert.equal(tail(GUIDE_V3), tail(GUIDE_V2), "type, company, role and rules sections are unchanged");
  assert.ok(GUIDE_V2.startsWith("# Classification guide v2"), "v2 itself is untouched");
});

// ---- config ----
test("shadow mode is off unless the flag is exactly 1; the cutoff and sampling rate are frozen and ignore the environment", () => {
  assert.equal(readShadowConfig({}).enabled, false);
  assert.equal(readShadowConfig({ READER_V2_SHADOW: "true" }).enabled, false);
  assert.equal(readShadowConfig({ READER_V2_SHADOW: "1" }).enabled, true);
  const hostile = readShadowConfig({ READER_V2_SHADOW: "1", READER_V2_CUTOFF: "2020-01-01T00:00:00Z", READER_V2_UNIFORM_RATE: "1" });
  assert.equal(hostile.cutoff.toISOString(), FROZEN.cutoff, "no environment variable can move the cutoff");
  assert.equal(hostile.uniformRate, FROZEN.uniformRate);
});

// ---- sampling arm and cohort ----
test("the uniform arm is deterministic, hits the requested rate, and depends only on (user, message)", () => {
  assert.equal(uniformArm("u", "m1", FROZEN.uniformRate), uniformArm("u", "m1", FROZEN.uniformRate));
  let hits = 0;
  const N = 20000;
  for (let i = 0; i < N; i += 1) if (uniformArm("user-a", `msg-${i}`, FROZEN.uniformRate)) hits += 1;
  assert.ok(Math.abs(hits / N - FROZEN.uniformRate) < 0.015, `rate ${hits / N}`);
  assert.equal(uniformArm("u", "x", 0), false);
  assert.equal(uniformArm("u", "x", 1), true);
  // Monotone in the rate: raising the rate never drops a message, so an arm can be widened but never reshuffled.
  for (let i = 0; i < 500; i += 1) if (uniformArm("u", `m${i}`, FROZEN.uniformRate)) assert.equal(uniformArm("u", `m${i}`, FROZEN.uniformRate * 2), true);
  assert.notEqual(Array.from({ length: 200 }, (_, i) => uniformArm("user-a", `m${i}`, FROZEN.uniformRate * 2)).join(), Array.from({ length: 200 }, (_, i) => uniformArm("user-b", `m${i}`, FROZEN.uniformRate * 2)).join());
});

test("cohort is decided by arrival time against the fixed cutoff, inclusive", () => {
  assert.equal(cohortOf(new Date(CUTOFF_MS - 1000), CFG.cutoff), "historical");
  assert.equal(cohortOf(new Date(CUTOFF_MS), CFG.cutoff), "prospective");
});

// ---- records ----
test("a hiring candidate is planned for a model read and waits in review until the worker output arrives", () => {
  const r = recordForCandidate("u1", mail(), CFG, true);
  assert.equal(r.plannedRead, true);
  assert.equal(r.isCandidate, true);
  assert.equal(r.cohort, "prospective");
  assert.equal(r.state, "review");
  assert.equal(r.reviewReason, "pending_model");
  assert.equal(r.readerVersion, READER_VERSION_V3);
  assert.equal(r.pipelineVersion, PIPELINE_VERSION);
  assert.equal(r.senderDomain, "acme.example");
  assert.equal(r.uniformArm, uniformArm("u1", "m1", FROZEN.uniformRate));
});

test("provable noise is vetoed: never read, final immediately, never a review item", () => {
  const r = recordForCandidate("u1", mail({ from: "Shop <deals@shop.example>", subject: "50% off everything", bodyText: "Free shipping on all orders. Unsubscribe." }), CFG, true);
  assert.equal(r.plannedRead, false);
  assert.equal(r.state, "not_recruiting");
  assert.equal(r.reviewReason, null);
  assert.equal(reviewItemOf(r), null);
});

test("mail phrased without application vocabulary is still planned for a read (the held-out failure class)", () => {
  const c = STRESS_SET.find((x) => x.id === "o1")!;
  const r = recordForCandidate("u1", stressEmail(c), CFG, true);
  assert.equal(r.plannedRead, true);
});

test("a sampled non-candidate is metadata only: not read, not recruiting, rules not applied", () => {
  const r = recordForNonCandidate("u1", { id: "z9", threadId: "tz", from: "Someone <a@b.example>", receivedAt: AT(20) }, CFG);
  assert.equal(r.isCandidate, false);
  assert.equal(r.plannedRead, false);
  assert.equal(r.planReason, "not_candidate");
  assert.equal(r.state, "not_recruiting");
  assert.equal(r.rulesRecruiting, false);
  assert.equal(r.rulesType, null);
  assert.equal(r.cohort, "prospective");
});

test("PRIVACY: a shadow record never carries the message text, subject or sender name", () => {
  const e = mail({ subject: "UNIQUE-SUBJECT-MARKER-77", bodyText: "UNIQUE-BODY-MARKER-91 Thank you for applying to the Intern position.", from: "Jordan Quill <jobs@acme.example>" });
  for (const rec of [recordForCandidate("u1", e, CFG, true), resolveRecord(recordForCandidate("u1", e, CFG, true), model(), new Date())]) {
    const dump = JSON.stringify(rec);
    assert.ok(!dump.includes("UNIQUE-SUBJECT-MARKER") && !dump.includes("UNIQUE-BODY-MARKER") && !dump.includes("Jordan Quill"));
  }
});

test("PRIVACY: the table has no column that could hold text, a subject, a snippet or a quote", () => {
  const names = Object.keys(getTableColumns(shadowReads));
  assert.ok(names.length > 30);
  for (const n of names) assert.doesNotMatch(n, /body|subject|snippet|quote|content|text|excerpt|raw/i, `column ${n}`);
});

// ---- resolution ----
test("readers that agree are accepted; fields come from the frozen reconcile and the model read is recorded", () => {
  const rules = recordForCandidate("u1", mail(), CFG, true);
  const forced = { ...rules, rulesRecruiting: true, rulesType: "applied" as const, rulesCompany: "Acme", rulesRole: "Software Engineer Intern" };
  const r = resolveRecord(forced, model(), AT(17));
  assert.equal(r.state, "recruiting");
  assert.equal(r.reviewReason, null);
  assert.equal(r.modelStatus, "ok");
  assert.equal(r.modelEvidenceHash, "abc123");
  assert.equal(r.finalCompany, "Acme");
  assert.equal(r.modelReadAt?.toISOString(), AT(17).toISOString());
});

test("disagreement becomes a review item carrying the model's suggestion, in both directions", () => {
  const base = recordForCandidate("u1", mail(), CFG, true);
  const rulesYes = resolveRecord({ ...base, rulesRecruiting: true }, model({ recruiting: false, type: null, stage: null, company: null, role: null }), new Date());
  assert.equal(rulesYes.state, "review");
  assert.equal(rulesYes.reviewReason, "reader_disagreement");
  assert.equal(rulesYes.modelSuggests, "not_recruiting");
  const rulesNo = resolveRecord({ ...base, rulesRecruiting: false }, model(), new Date());
  assert.equal(rulesNo.reviewReason, "reader_disagreement");
  assert.equal(rulesNo.modelSuggests, "recruiting");
  const item = reviewItemOf(rulesNo)!;
  assert.equal(item.actionable, true);
  assert.equal(item.reason, "reader_disagreement");
  assert.equal(item.rules.recruiting, false);
  assert.equal(item.modelSuggests, "recruiting");
  assert.equal(item.model?.certainty, "high");
});

test("a model that could not decide is a review item for a person, not a silent default", () => {
  const r = resolveRecord(recordForCandidate("u1", mail(), CFG, true), model({ certainty: "low" }), new Date());
  assert.equal(r.state, "review");
  assert.equal(r.reviewReason, "model_abstained");
  assert.equal(reviewItemOf(r)!.actionable, true);
});

test("items waiting on a worker are review rows but not actionable for a human", () => {
  const item = reviewItemOf(recordForCandidate("u1", mail(), CFG, true))!;
  assert.equal(item.reason, "pending_model");
  assert.equal(item.actionable, false);
  assert.equal(item.model, null);
});

test("resolution never alters ingestion fields, so the cohort, arm and routing cannot be steered by model output", () => {
  const rec = recordForCandidate("u1", mail(), CFG, true);
  const after = resolveRecord(rec, model({ recruiting: false }), new Date());
  for (const k of ["gmailMessageId", "gmailThreadId", "readerVersion", "pipelineVersion", "extractorVersion", "arrivedAt", "senderDomain", "cohort", "uniformArm", "isCandidate", "plannedRead", "planReason", "rulesRecruiting", "rulesType", "rulesCompany", "rulesRole"] as const) {
    assert.deepEqual(after[k], rec[k], k);
  }
  assert.deepEqual(resolveRecord(after, model({ recruiting: false }), new Date()).state, after.state, "re-resolving is idempotent");
});

test("a vetoed record ignores any model output (it was never sent)", () => {
  const veto = recordForCandidate("u1", mail({ from: "Shop <deals@shop.example>", subject: "50% off", bodyText: "Free shipping. Unsubscribe." }), CFG, true);
  assert.equal(resolveRecord(veto, model(), new Date()).state, "not_recruiting");
});

// ---- model input ----
test("shadow keys are opaque and stable; model input is redacted and bounded", () => {
  assert.equal(shadowKey("u1", "msg-123"), shadowKey("u1", "msg-123"));
  assert.notEqual(shadowKey("u1", "msg-123"), shadowKey("u2", "msg-123"));
  assert.doesNotMatch(shadowKey("u1", "msg-123"), /msg-123/);
  const i = buildShadowInput(mail({ bodyText: `Hi Jordan, apply at https://x.example/a?b=1 or mail jordan@x.example ${"y ".repeat(3000)}`, subject: "Hi Jordan" }), "k", 1, ["Jordan"]);
  assert.ok(i.body.length <= 1400);
  assert.doesNotMatch(`${i.subject} ${i.body}`, /Jordan|https?:|@x\.example/);
});

// ---- legacy-only and report ----
test("a keyword-only message is recorded with the rules' reading, never read by v2, and flagged as legacy", () => {
  const r = recordForLegacyOnly("u1", mail({ id: "L1" }), CFG);
  assert.equal(r.isCandidate, false);
  assert.equal(r.legacyQueryMatch, true);
  assert.equal(r.plannedRead, false);
  assert.equal(r.state, "not_recruiting");
  assert.equal(r.rulesRecruiting, true, "the rules saw the body, exactly as the product would have");
  assert.equal(recordForNonCandidate("u1", { id: "z", threadId: "t", from: "a@b.example", receivedAt: new Date() }, CFG).legacyQueryMatch, false);
  assert.equal(recordForCandidate("u1", mail(), CFG, null).legacyQueryMatch, null, "unknown stays unknown");
});

const row = (over: Partial<ReportRow> = {}): ReportRow => ({ gmailMessageId: "a", cohort: "historical", uniformArm: false, isCandidate: true, legacyQueryMatch: true, plannedRead: true, planReason: "protected", state: "recruiting", reviewReason: null, rulesRecruiting: true, modelRecruiting: true, modelStatus: "ok", typeReview: false, companyReview: false, roleReview: false, ...over });
const NO = { state: "not_recruiting" as const, rulesRecruiting: false, modelRecruiting: false };

test("the report compares old and v2 from stored facts alone, and counts what only the old path would show", () => {
  const rows: ReportRow[] = [
    row({ gmailMessageId: "zqidA" }),                                                                                           // both recruiting
    row({ gmailMessageId: "zqidB", legacyQueryMatch: false }),                                                                  // v2 finds, old never fetched
    row({ gmailMessageId: "zqidC", plannedRead: false, planReason: "noise:commerce", ...NO, rulesRecruiting: true, modelStatus: null, modelRecruiting: null }), // old shows it (rules yes); v2 vetoed it before any read
    row({ gmailMessageId: "zqidD", ...NO }),                                                                                    // both not
    row({ gmailMessageId: "zqidE", state: "review", reviewReason: "reader_disagreement", rulesRecruiting: true, modelRecruiting: false }),
    row({ gmailMessageId: "zqidF", state: "review", reviewReason: "pending_model", modelStatus: null, modelRecruiting: null }),
    row({ gmailMessageId: "zqidG", plannedRead: false, planReason: "noise:order", ...NO, modelStatus: null, modelRecruiting: null }),
    row({ gmailMessageId: "zqidH", isCandidate: false, legacyQueryMatch: false, plannedRead: false, planReason: "not_candidate", ...NO, uniformArm: true, modelStatus: null, modelRecruiting: null, cohort: "prospective" }),
    row({ gmailMessageId: "zqidI", isCandidate: false, legacyQueryMatch: true, plannedRead: false, planReason: "not_candidate", ...NO, rulesRecruiting: true, modelStatus: null, modelRecruiting: null }), // old shows it, v2 never reads it
    row({ gmailMessageId: "zqidJ", legacyQueryMatch: null }),                                                                   // legacy not recorded
  ];
  const s = summarize(rows);
  assert.equal(s.total, 10);
  assert.equal(s.candidates, 8);
  assert.equal(s.nonCandidateSample, 2);
  assert.equal(s.plannedReads, 6);
  assert.deepEqual(s.vetoed, { "noise:order": 1, "noise:commerce": 1 });
  assert.equal(s.pendingModel, 1);
  assert.equal(s.readers.disagree, 1);
  assert.equal(s.vsOld.bothRecruiting, 1);
  assert.equal(s.vsOld.v2OnlyRecruiting, 1);
  assert.equal(s.vsOld.oldOnlyRecruiting, 1);
  assert.equal(s.vsOld.bothNotRecruiting, 2, "zqidD and the vetoed message");
  assert.equal(s.vsOld.oldRecruitingNowReview, 1, "only the real disagreement");
  assert.equal(s.vsOld.awaitingModel, 1, "a pending row is not compared yet");
  assert.equal(s.vsOld.oldNotFetched, 1);
  assert.equal(s.vsOld.oldRecruitingOutsideV2Candidates, 1);
  assert.equal(s.vsOld.legacyUnknown, 1);
  const text = formatSummary(s);
  assert.doesNotMatch(text, /zqid/, "no message ids in the report");
  assert.match(text, /legacy flag not recorded for 1 rows/);
});

// ---- wiring ----
// On the product branch the sync no longer triggers collection (evidence is collected only by the guarded CLI on the frozen
// checkout; see lib/product-isolation.test.ts). The collector's own guarantees below still hold.
test("the collector cannot reach the product's own tables and logs no content", () => {
  const collect = readFileSync(new URL("./collect.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(collect + store, /recruitingEvents|opportunityOverrides|actionDismissals|saveExtractedEvents|savePredictions/, "shadow code never writes the product's tables");
  assert.doesNotMatch(collect, /console\.(log|error)\(.*(body|subject)/i, "no content is logged");
});

test("a model read is first-read-wins: the update only applies to rows with no read yet", () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /isNull\(shadowReads\.modelStatus\)\)\)\.returning/);
  assert.match(store, /ON CONFLICT DO NOTHING|onConflictDoNothing\(\)/, "ingestion is write-once");
});

test("the prospective protocol and the shadow doc name the exact versions the code carries, so the two cannot drift apart", () => {
  const protocol = readFileSync(new URL("../../../docs/prospective-evaluation-protocol.md", import.meta.url), "utf8");
  assert.ok(protocol.includes(READER_VERSION_V3), "reader version");
  assert.ok(protocol.includes(PIPELINE_VERSION), "pipeline version");
  const shadowDoc = readFileSync(new URL("../../../docs/architecture-v2-shadow.md", import.meta.url), "utf8");
  assert.ok(shadowDoc.includes(READER_VERSION_V3));
});
