import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLedger } from "../ledger/build.ts";
import { parseLedger } from "../ledger/types.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import type { RecruitingEmail } from "../recruiting/types.ts";
import { decide } from "./engine.ts";
import { shadowAssist, type ShadowTrace } from "./shadow.ts";

const NOW = new Date("2026-03-10T15:00:00Z");
const mail = (id: string, subject: string, bodyText: string, from = "Talent <talent@lumen-works.example>"): RecruitingEmail => ({ id, threadId: `t-${id}`, from, subject, bodyText, receivedAt: NOW, outbound: false });
const reading = (id: string, o: Partial<VerifiedOutput>): VerifiedOutput => ({ key: id, status: "ok", recruiting: true, type: "rejection", stage: "closed", company: "Lumen Works", companySource: "quote", role: null, dateText: null, certainty: "high", evidence: { hash: "ab12cd34ef56ab12", offset: 40 }, rejections: [], ...o });
const OPTS = { readerVersion: "test" };

const CLOSURE = "Dear Sam,\nThank you for your interest in the Analyst role at Lumen Works. After careful consideration, we have decided not to move forward with your application at this time.\nBest,\nTalent team";
const BLAND = "Hello Sam, we wanted to share an update on your application to Lumen Works. Thank you for your interest and for your time.";
const ENDING = "Hello Sam, we wanted to share an update on your application to Lumen Works. We have decided to pursue other candidates for this role. Thank you.";
const PROMO = "Join the Lumen Works Insiders community for free career tips and events. Unsubscribe | Manage preferences | View in browser. You're receiving this because you subscribed. Sponsored.";
const ALERT = "Jobs matching your profile: Analyst at Northwind, Engineer at Halden. Unsubscribe | Manage preferences | View in browser. You're receiving this email because you set up a job alert. Sponsored";

test("a ledger holds claims, never text: only enumerated values, hashes and offsets", () => {
  const m = mail("m1", "Update on your application", CLOSURE);
  const l = buildLedger(m, null, reading("m1", {}), OPTS);
  const dump = JSON.stringify(l);
  for (const phrase of ["careful consideration", "decided not to move forward", "Dear Sam", "Analyst role", "talent team"]) assert.equal(dump.toLowerCase().includes(phrase.toLowerCase()), false, `ledger leaked: ${phrase}`);
  assert.ok(l.claims.some((c) => c.kind === "fact" && c.value === "closure_wording"));
  assert.ok(l.claims.every((c) => c.kind === "employer" || c.kind === "role" || c.value.length <= 30));
  assert.deepEqual(parseLedger(JSON.parse(dump)), l, "a stored ledger round-trips");
});

test("parseLedger refuses anything that could carry content", () => {
  const good = buildLedger(mail("m2", "Update on your application", CLOSURE), null, reading("m2", {}), OPTS);
  const withClaim = (patch: Record<string, unknown>) => ({ ...good, claims: [...good.claims.slice(1), { ...good.claims[0], ...patch }] });
  assert.throws(() => parseLedger({ ...good, claims: [{ ...good.claims[0], kind: "employer", value: "We have decided not to move forward\nwith your application", id: "model.local-model.employer.We have decided not to move forward\nwith your application" }] }), /multi-line|too long/);
  assert.throws(() => parseLedger({ ...good, claims: [{ ...good.claims[0], kind: "role", value: "x".repeat(200), id: `model.local-model.role.${"x".repeat(200)}` }] }), /too long/);
  assert.throws(() => parseLedger(withClaim({ kind: "fact", value: "the message said they will call on Friday" })), /fact value/);
  assert.throws(() => parseLedger(withClaim({ strength: 4 })), /strength/);
  assert.throws(() => parseLedger(withClaim({ grounding: { hash: "NOT HEX!", offset: 3 } })), /grounding/);
  assert.throws(() => parseLedger({ ...good, claims: [good.claims[0], good.claims[0]] }), /duplicate/);
  assert.throws(() => parseLedger({ ...good, extra: 1, version: 2 }), /version/);
});

test("competing evidence is preserved: a promotion read as a rejection is contested, with both sides named", () => {
  const m = mail("m3", "You're invited: Lumen Works Insiders community", PROMO);
  const l = buildLedger(m, null, reading("m3", { type: "rejection" }), OPTS);
  assert.ok(l.claims.some((c) => c.source === "model" && c.kind === "event_type" && c.value === "rejection"), "the model's claim is kept");
  assert.ok(l.claims.some((c) => c.kind === "fact" && c.value === "not_own_process"), "the opposing fact is kept");
  const v = decide(l);
  assert.equal(v.state, "contested");
  assert.equal(v.terminal, "none", "a contested ending is withheld");
  assert.notEqual(v.placement, "pipeline");
  assert.ok(v.recruiting.for.some((id) => id.startsWith("model.")) && v.recruiting.against.some((id) => id.endsWith("not_own_process")));
});

test("a job-alert digest the model read as an application is contested, never a pipeline event", () => {
  const m = mail("m4", "5 new jobs for you this week", ALERT, "Jobs <alerts@board.example>");
  const l = buildLedger(m, null, reading("m4", { type: "applied", stage: "applied" }), OPTS);
  const v = decide(l);
  assert.notEqual(v.placement, "pipeline");
  assert.ok(v.recruiting.against.some((id) => id.endsWith("marketing_alert")), "the opposing fact is named");
  assert.ok(l.claims.some((c) => c.source === "model" && c.kind === "event_type" && c.value === "applied"), "and the model's claim is still in the ledger");
});

test("a bland rejection with no closure wording is still a proposed ending (unopposed), not lost", () => {
  const m = mail("m5", "Application update", BLAND);
  const v = decide(buildLedger(m, null, reading("m5", {}), OPTS));
  assert.equal(v.terminal, "proposed", "one source names the ending: proposed, not verified");
  assert.equal(v.placement, "pipeline");
  assert.notEqual(v.state, "contested");
});

test("closure wording plus the model is a verified ending", () => {
  const m = mail("m6", "Update on your application", CLOSURE);
  const v = decide(buildLedger(m, null, reading("m6", {}), OPTS));
  assert.equal(v.state, "verified");
  assert.equal(v.terminal, "verified");
  assert.equal(v.type.value, "rejection");
});

test("a medium-certainty finding is a question, not an event", () => {
  const m = mail("m7", "Notes from the team", "Hello Sam, a note from the Lumen Works team about what is happening this month.");
  const v = decide(buildLedger(m, null, reading("m7", { certainty: "medium", type: "status_update" }), OPTS));
  assert.equal(v.placement, "possible");
});

test("a person's decision outweighs every automatic reading, both ways", () => {
  const m = mail("m8", "You're invited: Lumen Works Insiders community", PROMO);
  const yes = decide(buildLedger(m, null, reading("m8", { recruiting: false, type: null }), { ...OPTS, person: { type: "interview_invite" } }));
  assert.equal(yes.state, "settled");
  assert.equal(yes.placement, "pipeline");
  assert.equal(yes.type.value, "interview_invite");
  const no = decide(buildLedger(mail("m9", "Application update", CLOSURE), null, reading("m9", {}), { ...OPTS, person: { notRecruiting: true } }));
  assert.equal(no.state, "settled");
  assert.equal(no.placement, "none");
});

test("the verdict is a pure function of the ledger: same claims, same verdict", () => {
  const l = buildLedger(mail("m10", "Application update", BLAND), null, reading("m10", {}), OPTS);
  assert.deepEqual(decide(l), decide(parseLedger(JSON.parse(JSON.stringify(l)))));
});

test("shadow engine: nothing is removed from the rule reader's events, and a contested ending leaves the event as it was", () => {
  const promo = mail("p1", "You're invited: Lumen Works Insiders community", PROMO);
  const trace: ShadowTrace = new Map();
  const events = shadowAssist([], [promo], new Map([["p1", reading("p1", { type: "rejection" })]]), trace);
  assert.equal(events.some((e) => e.gmailMessageId === "p1" && e.type === "rejection" && !e.signals.includes("near-miss")), false, "no pipeline rejection from a promotion");
  assert.equal(trace.get("p1")?.state, "contested");
  const real = mail("r1", "Application update", BLAND);
  const out = shadowAssist([], [real], new Map([["r1", reading("r1", {})]]), trace);
  const ev = out.find((e) => e.gmailMessageId === "r1")!;
  assert.equal(ev.type, "rejection");
  assert.ok(ev.signals.some((x) => x.startsWith("decision:")) && ev.signals.includes("terminal:proposed"), "the event says its ending is proposed, not verified");
});

test("an everyday ending sentence corroborates the model's ending: verified, where the same reading without one is only proposed", () => {
  const withSentence = decide(buildLedger(mail("m11", "Application update", ENDING), null, reading("m11", {}), OPTS));
  assert.equal(withSentence.terminal, "verified");
  assert.ok(withSentence.type.for.some((id) => id.endsWith("ending_wording")));
  const without = decide(buildLedger(mail("m12", "Application update", BLAND), null, reading("m12", {}), OPTS));
  assert.equal(without.terminal, "proposed");
});

test("a rule-found rejection with no ending sentence (a receipt typed as a rejection) is proposed, never settled", () => {
  const receipt = mail("m13", "Thank you for applying", "Hello Sam, thank you for your interest in Lumen Works. Your application has been received and is being reviewed.");
  const ruleEvent = { gmailMessageId: "m13", gmailThreadId: "t-m13", occurredAt: NOW, outbound: false, senderName: "Talent", senderDomain: "lumen-works.example", subject: receipt.subject, type: "rejection" as const, company: "Lumen Works", role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.8, fieldConfidence: { type: 0.8, company: 0.8, role: 0 }, reviewReasons: [], signals: [] };
  const out = shadowAssist([ruleEvent], [receipt], new Map([["m13", reading("m13", { recruiting: true, type: "applied", stage: "applied" })]]));
  assert.ok(out[0].signals.includes("terminal:proposed"));
  const real = mail("m14", "Update", ENDING);
  const out2 = shadowAssist([{ ...ruleEvent, gmailMessageId: "m14", gmailThreadId: "t-m14", subject: "Update" }], [real], new Map([["m14", reading("m14", {})]]));
  assert.ok(!out2[0].signals.includes("terminal:proposed"), "a real ending sentence settles it");
});

test("an offer that the text says is a welcome or programme notice is contested, however much else supports it", () => {
  const m = mail("m15", "Welcome to Lumen Works Academy!", "Welcome to Lumen Works Academy! Congratulations, you're in. Set up your profile to get tips. Unsubscribe | Manage preferences.");
  const v = decide(buildLedger(m, null, reading("m15", { type: "offer", stage: "offer" }), OPTS));
  assert.equal(v.state, "contested");
  assert.notEqual(v.placement, "pipeline");
  const real = decide(buildLedger(mail("m16", "Your offer", "We are pleased to offer you the position. Your offer letter and next steps are attached for your application."), null, reading("m16", { type: "offer", stage: "offer" }), OPTS));
  assert.notEqual(real.state, "contested", "a real offer about the reader's own process is not");
});
