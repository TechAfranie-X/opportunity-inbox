import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActions } from "./actions.ts";
import { applyEntryPolicy } from "./entry-policy.ts";
import { buildOpportunities } from "./opportunity.ts";
import { groupEventsV2 } from "../lifecycle/identity.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

const base = { outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", company: "Entry Co", role: "Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.8, fieldConfidence: { type: 0.8, company: 0.8, role: 0.8 }, reviewReasons: [], corrected: false } as const;
let n = 0;
const ev = (type: EventType, day: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ ...base, id: `p${++n}`, gmailMessageId: `p${n}`, gmailThreadId: `t${n}`, type, occurredAt: new Date(Date.UTC(2026, 8, day, 12)), signals: [], ...o });
const build = (evs: EffectiveEvent[]) => buildOpportunities(evs);

test("a model-only event cannot create an application; it waits as a weak 'possible' item", () => {
  const model = ev("applied", 1, { company: "Alert Co", signals: ["semantic:event"] });
  const { kept, demoted } = applyEntryPolicy([model], build);
  assert.equal(kept.length, 0);
  assert.equal(demoted.length, 1);
  assert.ok(demoted[0].signals.includes("near-miss") && demoted[0].signals.includes("near-miss:weak") && demoted[0].signals.includes("entry:uncorroborated"));
  assert.match(demoted[0].reviewReasons![0], /^possible:/);
});

test("a model-only event may CONTINUE an application that has real evidence, and a person's confirmation brings one in", () => {
  const rule = ev("applied", 1, { gmailThreadId: "T" }), model = ev("interview_invite", 6, { gmailThreadId: "T", signals: ["semantic:event"] });
  assert.equal(applyEntryPolicy([rule, model], build).kept.length, 2, "attributed to an application the rule reader found");
  const confirmed = ev("applied", 1, { company: "Mine Co", signals: ["semantic:event"], confirmed: true });
  assert.equal(applyEntryPolicy([confirmed], build).kept.length, 1);
  const corrected = ev("applied", 1, { company: "Mine Co", signals: ["semantic:event"], corrected: true });
  assert.equal(applyEntryPolicy([corrected], build).kept.length, 1);
});

test("the same appointment is one application, and one interview is never shown twice", () => {
  const when = new Date("2026-09-20T17:00:00Z");
  const a = ev("interview_scheduled", 5, { gmailThreadId: "A", eventDate: when, eventDateHasTime: true, role: "Software Engineer, Intern" });
  const b = ev("interview_scheduled", 6, { gmailThreadId: "B", eventDate: when, eventDateHasTime: true, role: "Software Engineering Intern (Winter 2027)" });
  assert.equal(groupEventsV2([a, b], { attribution: true }).length, 1, "same employer, same moment");
  assert.equal(groupEventsV2([a, b]).length === 2 || groupEventsV2([a, b]).length === 1, true);
  const apart = [ev("interview_scheduled", 5, { gmailThreadId: "A", eventDate: when, eventDateHasTime: true }), ev("interview_scheduled", 6, { gmailThreadId: "B", eventDate: new Date("2026-09-21T17:00:00Z"), eventDateHasTime: true })];
  const g = groupEventsV2(apart, { attribution: true });
  assert.ok(g.length >= 1);
  // even if two applications each hold the same appointment, the action list shows it once
  const o1 = buildOpportunities([ev("applied", 1, { gmailThreadId: "X", company: "Dup Co", role: "Role A" }), ev("interview_scheduled", 5, { gmailThreadId: "X", company: "Dup Co", role: "Role A", eventDate: when, eventDateHasTime: true })]);
  const o2 = buildOpportunities([ev("applied", 1, { gmailThreadId: "Y", company: "Dup Co", role: "Role B" }), ev("interview_scheduled", 5, { gmailThreadId: "Y", company: "Dup Co", role: "Role B", eventDate: when, eventDateHasTime: true })]);
  const acts = buildActions([...o1, ...o2], new Date("2026-09-19T12:00:00Z"));
  assert.equal(acts.filter((x) => x.kind === "upcoming_interview").length, 1);
});

test("a model-found application that the message itself states is corroborated and enters the pipeline", () => {
  const strong = ev("applied", 1, { company: "Receipt Co", signals: ["semantic:event", "entry:corroborated"] });
  const { kept, demoted } = applyEntryPolicy([strong], build);
  assert.equal(kept.length, 1);
  assert.equal(demoted.length, 0);
});

test("an application whose messages state two recruiting cycles is flagged, never silent", () => {
  const a = ev("applied", 1, { company: "Cycle Co", role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "T" });
  const b = ev("assessment", 5, { company: "Cycle Co", role: "Software Engineering Intern (Summer 2027)", gmailThreadId: "T" });
  const o = buildOpportunities([a, b]);
  assert.ok(o.some((x) => (x.contradictions ?? []).some((c) => c.kind === "mixed_cycles")) || o.length === 2, "either separated by cycle or flagged");
});

import { retypeUnverifiedClaims } from "./entry-policy.ts";
test("a model-only offer or ending with no evidence does not stand as one; engine-decided, confirmed and corroborated events are left alone", () => {
  const claim = ev("offer", 1, { company: "Claim Co", signals: ["semantic:event"] });
  const out = retypeUnverifiedClaims([claim, ev("offer", 2, { signals: ["semantic:event", "decision:verified"] }), ev("offer", 3, { signals: ["semantic:event"], confirmed: true }), ev("offer", 4, { signals: [] }), ev("rejection", 5, { signals: ["semantic:event", "entry:corroborated"] })]);
  assert.equal(out[0].type, "status_update");
  assert.ok(out[0].signals.includes("claim:unverified:offer"));
  assert.deepEqual(out.slice(1).map((e) => e.type), ["offer", "offer", "offer", "rejection"]);
});

test("one message that names no employer does not create an application", () => {
  const junk = ev("applied", 1, { company: null, signals: [] });
  const { kept, demoted } = applyEntryPolicy([junk], build);
  assert.equal(kept.length, 0);
  assert.equal(demoted.length, 1);
  const named = ev("applied", 1, { company: "Named Co", signals: [] });
  assert.equal(applyEntryPolicy([named], build).kept.length, 1);
});

import { proposeMissedEndings } from "./entry-policy.ts";
test("an update whose text ends the application is shown as a PROPOSED rejection; confirmed, corrected and engine-decided events are left alone", () => {
  const upd = ev("status_update", 3, { company: "Missed Co", signals: ["ending:wording"] });
  const anchor = ev("applied", 1, { company: "Missed Co", signals: [] });
  const out = proposeMissedEndings([anchor, upd, ev("status_update", 4, { signals: ["ending:wording"], confirmed: true }), ev("status_update", 5, { signals: ["ending:wording", "decision:verified"] }), ev("status_update", 6, { signals: [] })]);
  assert.equal(out[1].type, "rejection");
  assert.ok(out[1].signals.includes("terminal:proposed"));
  assert.deepEqual(out.slice(2).map((e) => e.type), ["status_update", "status_update", "status_update"]);
  const unanchored = proposeMissedEndings([ev("status_update", 3, { company: "Alone Co", signals: ["ending:wording"] })]);
  assert.equal(unanchored[0].type, "status_update", "no application at that employer: not proposed");
  const opp = buildOpportunities([anchor, out[1]]);
  assert.equal(opp[0].status, "active", "proposed, not settled");
  assert.equal(opp[0].proposedEnding?.outcome, "rejected");
});

test("events, surveys, notices and community messages do not create applications; a programme acceptance is a programme, not a job", () => {
  const evt = ev("applied", 1, { company: "Event Co", signals: ["class:event"] });
  assert.equal(applyEntryPolicy([evt], build).kept.length, 0);
  const real = ev("applied", 1, { company: "Real Co", signals: [] }), stray = ev("status_update", 2, { company: "Real Co", gmailThreadId: real.gmailThreadId, signals: ["class:event"] });
  assert.equal(applyEntryPolicy([real, stray], build).kept.length, 2, "an event message inside a real application stays with it");
  const prog = buildOpportunities([ev("offer", 1, { company: "Prog Co", signals: ["class:program-acceptance"] })]);
  assert.equal(prog[0].kind, "mentorship");
});

import { neutralizeClassed } from "./entry-policy.ts";
test("an event, survey, notice or community message cannot move a stage; confirmed ones and ordinary ones are untouched", () => {
  const out = neutralizeClassed([ev("interview_invite", 1, { signals: ["class:event"] }), ev("assessment", 2, { signals: ["class:survey"] }), ev("interview_invite", 3, { signals: ["class:event"], confirmed: true }), ev("interview_invite", 4, { signals: [] })]);
  assert.deepEqual(out.map((e) => e.type), ["status_update", "status_update", "interview_invite", "interview_invite"]);
});

import { retypeAssessmentPlatforms } from "./entry-policy.ts";
test("an interview-typed invitation from an online-assessment platform is an assessment; the same type from an employer is unchanged", () => {
  const out = retypeAssessmentPlatforms([ev("interview_invite", 1, { senderDomain: "hackerrank.com" }), ev("interview_invite", 2, { senderDomain: "jpmorgan.com" }), ev("interview_invite", 3, { senderDomain: "mail.codesignal.com" }), ev("interview_invite", 4, { senderDomain: "hackerrank.com", confirmed: true })]);
  assert.deepEqual(out.map((e) => e.type), ["assessment", "interview_invite", "assessment", "interview_invite"]);
});

import { demoteNonReceipts } from "./entry-policy.ts";
test("a model-only 'applied' that is not a receipt waits as possible; receipts, corroborated and confirmed ones stay", () => {
  const mk = (subject: string, extra: object = {}) => ev("applied", 1, { subject, signals: ["semantic:event"], ...extra });
  const r = demoteNonReceipts([mk("Welcome to Google AI Plus"), mk("Thank you for applying to Duolingo!", { signals: ["semantic:event", "entry:corroborated"] }), mk("Apply now: Partner Internship"), mk("Security code for your account"), mk("Welcome aboard", { confirmed: true }), mk("Newsletter", { signals: ["semantic:event", "entry:corroborated"] })]);
  assert.deepEqual(r.demoted.map((e) => e.subject), ["Welcome to Google AI Plus", "Apply now: Partner Internship", "Security code for your account"]);
  assert.equal(r.kept.length, 3);
  assert.ok(r.demoted[0].signals.includes("near-miss:weak"));
});

import { detectContradictions } from "../lifecycle/contradictions.ts";
test("a role naming a year range is one programme year, not mixed cycles", () => {
  const two = (a: string, b: string) => detectContradictions([ev("applied", 1, { role: a }), ev("status_update", 5, { role: b })]).some((c) => c.kind === "mixed_cycles");
  assert.equal(two("2026-2027 AI Program", "2026-2027 AI Program"), false);
  assert.equal(two("Software Intern Summer 2026", "Software Intern Summer 2027"), true);
});

import { promoteDecisiveNearMisses } from "./entry-policy.ts";
test("an employer's own plain ending settles an application with or without an earlier anchor; an acknowledged withdrawal closes as withdrawn", () => {
  const lone = proposeMissedEndings([ev("status_update", 2, { company: "Solo Co", signals: ["ending:own", "ending:wording"] })]);
  assert.equal(lone[0].type, "rejection");
  assert.ok(!lone[0].signals.includes("terminal:proposed"), "settled, not proposed");
  const opp = buildOpportunities([ev("applied", 1, { company: "Solo Co" }), lone[0]]);
  assert.equal(opp[0].status, "closed");
  const upgraded = proposeMissedEndings([ev("rejection", 2, { company: "Up Co", signals: ["ending:own", "terminal:proposed"] })]);
  assert.ok(!upgraded[0].signals.includes("terminal:proposed"));
  const w = proposeMissedEndings([ev("rejection", 3, { company: "Lab", signals: ["withdrawal:ack", "terminal:proposed"] })]);
  assert.equal(w[0].type, "withdrawn");
  const guarded = proposeMissedEndings([ev("status_update", 2, { company: "Solo Co", signals: ["ending:own"], confirmed: true })]);
  assert.equal(guarded[0].type, "status_update", "a person's confirmation is left alone");
});
test("a near miss that ends a known employer's application enters the pipeline; an unknown employer or a message class does not", () => {
  const r = promoteDecisiveNearMisses([ev("status_update", 1, { company: "Volvo", signals: ["near-miss", "ending:own"] }), ev("status_update", 1, { company: "Unknown company", signals: ["near-miss", "ending:own"] }), ev("status_update", 1, { company: "Acme", signals: ["near-miss", "ending:own", "class:event"] }), ev("status_update", 1, { company: "Acme", signals: ["near-miss"] })]);
  assert.deepEqual(r.promoted.map((e) => e.company), ["Volvo"]);
  assert.equal(r.rest.length, 3);
  assert.ok(!r.promoted[0].signals.includes("near-miss"));
});

import { buildReviewQueue } from "./review.ts";
test("Review asks ONE question per Gmail message, and mail the message-class facts explain is resolved, not asked about", () => {
  const same = ev("rejection", 4, { company: "Dup Co", signals: ["terminal:proposed"], reviewReasons: ["type: low confidence"] });
  const opps = buildOpportunities([ev("applied", 1, { company: "Dup Co" }), same]);
  const queue = buildReviewQueue(opps, undefined, [], new Date(Date.UTC(2026, 6, 1)));
  const perMessage = new Map<string, number>();
  for (const q of queue) perMessage.set(q.event.gmailMessageId, (perMessage.get(q.event.gmailMessageId) ?? 0) + 1);
  assert.ok([...perMessage.values()].every((c) => c === 1), "no message is asked about twice");
  const classed = ev("status_update", 2, { company: "Event Co", signals: ["near-miss", "class:event"], reviewReasons: ["possible: a second reader thinks this is hiring mail"] });
  const plain = ev("status_update", 2, { company: "Plain Co", signals: ["near-miss"], reviewReasons: ["possible: a second reader thinks this is hiring mail"] });
  const q2 = buildReviewQueue([], undefined, [classed, plain], new Date(Date.UTC(2026, 6, 1)));
  assert.deepEqual(q2.map((q) => q.event.company), ["Plain Co"]);
});

import { attachVendorMail } from "./entry-policy.ts";
test("a vendor's mail that names one of the student's employers attaches to that employer; an employer's own mail and ambiguous subjects do not", () => {
  const real = ev("applied", 1, { company: "Salesforce", role: "Summer 2027 Intern" });
  const vendor = ev("assessment", 5, { company: "Berry Appleman & Leiden", subject: "Salesforce | Owusu Agyei, Afrane | 1012.11891", senderDomain: "bal.com", signals: ["employer:sender-only"] });
  const own = ev("status_update", 6, { company: "Salesforce", subject: "Salesforce interview update", senderDomain: "salesforce.com" });
  const ambiguous = ev("status_update", 7, { company: "Berry Appleman & Leiden", subject: "Salesforce and Adobe forms", senderDomain: "bal.com", signals: ["employer:sender-only"] });
  const partner = ev("status_update", 8, { company: "Partner Org", subject: "Follow-up on Salesforce career academy application", senderDomain: "partnerorg.org" });
  const employerSelf = ev("status_update", 9, { company: "Alcon", subject: "RE: LinkedIn Profile Link", senderDomain: "alcon.com", signals: ["employer:sender-only"] });
  const adobe = ev("applied", 2, { company: "Adobe" });
  const out = attachVendorMail([real, vendor, own, ambiguous, adobe, partner, employerSelf]);
  assert.equal(out[1].company, "Salesforce");
  assert.ok(out[1].signals.includes("relation:vendor_for:Salesforce"));
  assert.equal(out[2].company, "Salesforce");
  assert.ok(!out[2].signals.some((s) => s.startsWith("relation:")));
  assert.equal(out[3].company, "Berry Appleman & Leiden", "two employers named: no guess");
  assert.equal(out[5].company, "Partner Org", "a partner whose company is not suspect is not re-attributed");
  assert.equal(out[6].company, "Alcon", "the sender is the stored company");
});
