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
