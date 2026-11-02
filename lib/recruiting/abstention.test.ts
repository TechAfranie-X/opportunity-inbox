import assert from "node:assert/strict";
import test from "node:test";
import { buildActions } from "./actions.ts";
import { evaluate, type LabelRow } from "./evaluator.ts";
import { extractEvent } from "./extract.ts";
import { buildOpportunities, eventNeedsReview } from "./opportunity.ts";
import { DEFAULT_POLICY, decide, forField, parsePolicy } from "./policy.ts";
import { buildPredictions } from "./predictions.ts";
import type { EffectiveEvent, RecruitingEmail } from "./types.ts";

const mail = (o: Partial<RecruitingEmail>): RecruitingEmail => ({ id: "m", threadId: "t", from: "Acme Recruiting <jobs@acme.com>", subject: "", bodyText: "", receivedAt: new Date("2026-03-01T12:00:00Z"), outbound: false, ...o });
const ev = (o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({
  id: "e1", gmailMessageId: "m1", gmailThreadId: "t1", occurredAt: new Date("2026-03-01T12:00:00Z"), outbound: false, senderName: "Acme", senderDomain: "acme.com", subject: "s",
  type: "assessment", company: "Acme", role: null, eventDate: new Date("2026-03-05T00:00:00Z"), eventDateHasTime: false, dateKind: "deadline", confidence: 0.9, signals: [], corrected: false, ...o,
});

test("type confidence reflects the evidence tier that decided it", () => {
  const subj = extractEvent(mail({ subject: "Your Acme online assessment", bodyText: "Please complete it." }));
  const body = extractEvent(mail({ subject: "Hello from the team", bodyText: "Thank you for applying to Acme. We received your application for the Software Engineer role." }));
  assert.equal(subj?.fieldConfidence?.type, 0.9);
  assert.ok(body && body.fieldConfidence!.type <= 0.7 && body.fieldConfidence!.type >= 0.5, `${body?.fieldConfidence?.type}`);
});

test("company confidence: corroborated employer is trusted, a conflicting one is flagged and explained", () => {
  const good = extractEvent(mail({ subject: "Thank you for applying to Acme", bodyText: "We received your application for the Software Engineer Intern role." }))!;
  assert.ok(good.fieldConfidence!.company >= 0.8);
  assert.deepEqual(good.reviewReasons, []);
  const conflict = extractEvent(mail({ subject: "Thank you for applying to Globex", bodyText: "We received your application for the Software Engineer Intern role." }))!;
  assert.ok(conflict.fieldConfidence!.company < 0.4, `${conflict.fieldConfidence!.company}`);
  assert.ok(conflict.reviewReasons!.length > 0);
  assert.ok(eventNeedsReview({ ...ev(), ...conflict, id: "x", corrected: false }, DEFAULT_POLICY));
  assert.ok(!eventNeedsReview({ ...ev(), ...good, id: "x", corrected: false }, DEFAULT_POLICY));
});

test("reasons are evidence descriptions, never message text", () => {
  const e = extractEvent(mail({ subject: "Thank you for applying to Globex", bodyText: "TOP SECRET BODY We received your application for the Software Engineer role." }))!;
  assert.ok(!JSON.stringify(e.reviewReasons).includes("TOP SECRET"));
});

test("defaults leave values untouched and flag only clear doubt; rows without field confidence behave as before", () => {
  assert.equal(eventNeedsReview(ev({ confidence: 0.9 })), false);
  assert.equal(eventNeedsReview(ev({ confidence: 0.5 })), true); // legacy row: event-level confidence below 0.6
  assert.equal(eventNeedsReview(ev({ fieldConfidence: { type: 0.9, company: 0.55, role: 0 } })), false); // a single employer-domain match is not flagged by default
  assert.equal(eventNeedsReview(ev({ fieldConfidence: { type: 0.9, company: 0.3, role: 0 } })), true);
  assert.equal(eventNeedsReview(ev({ type: "status_update", fieldConfidence: { type: 0.9, company: 0.9, role: 0 } })), false); // a generic update is not a doubt
  assert.equal(eventNeedsReview(ev({ corrected: true, fieldConfidence: { type: 0.1, company: 0.1, role: 0 } })), false); // a person's correction settles it
});

test("a stricter policy flags more and the opportunity says so", () => {
  const e = ev({ fieldConfidence: { type: 0.9, company: 0.55, role: 0 } });
  const relaxed = buildOpportunities([e]);
  const strict = buildOpportunities([e], new Map(), { ...DEFAULT_POLICY, fields: { company: { reviewBelow: 0.7 } } });
  assert.equal(relaxed[0].needsReview, false);
  assert.equal(strict[0].needsReview, true);
});

test("abstention on Today: an uncertain action is downgraded, not hidden; default policy changes nothing", () => {
  const now = new Date("2026-03-10T09:00:00Z");
  const low = [...buildOpportunities([ev({ eventDate: new Date("2026-03-10T00:00:00Z"), fieldConfidence: { type: 0.9, company: 0.3, role: 0 } })])];
  const normal = buildActions(low, now);
  assert.equal(normal[0].bucket, "today");
  assert.equal(normal[0].uncertain, undefined);
  const careful = buildActions(low, now, new Set(), { ...DEFAULT_POLICY, urgentMinConfidence: 0.5 });
  assert.equal(careful[0].bucket, "worth_a_look");
  assert.equal(careful[0].uncertain, true);
  const sure = buildOpportunities([ev({ eventDate: new Date("2026-03-10T00:00:00Z"), fieldConfidence: { type: 0.9, company: 0.9, role: 0 } })]);
  assert.equal(buildActions(sure, now, new Set(), { ...DEFAULT_POLICY, urgentMinConfidence: 0.5 })[0].bucket, "today");
  const fixed = buildOpportunities([ev({ eventDate: new Date("2026-03-10T00:00:00Z"), corrected: true, fieldConfidence: { type: 0.9, company: 0.1, role: 0 } })]);
  assert.equal(buildActions(fixed, now, new Set(), { ...DEFAULT_POLICY, urgentMinConfidence: 0.5 })[0].bucket, "today");
});

test("per-field thresholds and policy parsing", () => {
  assert.deepEqual(forField(DEFAULT_POLICY, "company"), { reviewBelow: 0.4, unknownBelow: 0 });
  assert.deepEqual(forField(DEFAULT_POLICY, "role"), { reviewBelow: 0.6, unknownBelow: 0 });
  assert.equal(decide("Acme", 0.35, DEFAULT_POLICY, "company").state, "review");
  assert.equal(decide("Acme", 0.45, DEFAULT_POLICY, "company").state, "accepted");
  const p = parsePolicy('{"unknownBelow":0.3,"urgentMinConfidence":0.5,"fields":{"company":{"reviewBelow":0.7},"bogus":{"x":1}}}');
  assert.equal(p.unknownBelow, 0.3);
  assert.equal(p.urgentMinConfidence, 0.5);
  assert.equal(p.fields?.company?.reviewBelow, 0.7);
  assert.equal(parsePolicy("not json"), DEFAULT_POLICY);
  assert.equal(parsePolicy('{"reviewBelow":7}').reviewBelow, DEFAULT_POLICY.reviewBelow); // out-of-range ignored
  assert.equal(parsePolicy(undefined), DEFAULT_POLICY);
});

test("predictions persist the field confidences and reasons that the policy reads", () => {
  const p = buildPredictions([mail({ id: "a", subject: "Thank you for applying to Globex", bodyText: "We received your application for the Software Engineer role." })]);
  assert.ok(p[0].fieldConfidence && p[0].fieldConfidence.company < 0.4);
  assert.ok(p[0].reviewReasons.length > 0);
});

test("the evaluator measures a policy: stricter company threshold turns confident-wrong into review", () => {
  const lab = (id: string, field: string, value: unknown): LabelRow => ({ gmailMessageId: id, field: field as never, value, source: "dev_human", createdAt: new Date("2026-01-01") });
  const ids = ["1", "2", "3", "4"];
  const labels = ids.flatMap((i) => [lab(i, "is_recruiting", true), lab(i, "type", "applied"), lab(i, "company", "Acme")]);
  const wrong = new Set(["1", "2"]);
  const base = {
    kind: "dev_random" as const, datasetName: "d", asOf: new Date("2026-01-01"), messageIds: ids, threadOf: new Map(ids.map((i) => [i, `t${i}`])), labels,
    predictions: ids.map((i) => ({ gmailMessageId: i, gmailThreadId: `t${i}`, extractorVersion: "v", decision: "recruiting" as const, outbound: false, senderDomain: "", type: "applied" as const, company: wrong.has(i) ? "Greenhouse" : "Acme", role: null, eventDate: null, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: wrong.has(i) ? 0.5 : 0.9, role: 0 }, signals: [], reviewReasons: [] })),
    predictedGroups: new Map(), predictedTodayThreads: new Set<string>(),
  };
  const defaults = evaluate(base);
  assert.deepEqual([defaults.company.confidentWrong.k, defaults.company.confidentWrong.n], [2, 4]); // 0.5 passes the 0.4 line: shown confidently wrong
  const careful = evaluate({ ...base, policy: { ...DEFAULT_POLICY, fields: { company: { reviewBelow: 0.7 } } } });
  assert.deepEqual([careful.company.confidentWrong.k, careful.company.confidentWrong.n], [0, 2]); // now flagged, no longer confident
  const withholding = evaluate({ ...base, policy: { ...DEFAULT_POLICY, fields: { company: { unknownBelow: 0.7 } } } });
  assert.equal(withholding.company.abstained.k, 2);
  assert.equal(withholding.company.exact.k, 2); // coverage cost is visible
});
