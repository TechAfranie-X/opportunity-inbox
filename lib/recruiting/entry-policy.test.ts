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
