import assert from "node:assert/strict";
import test from "node:test";
import { annotateTimeline, nextMoment, peopleFor, pulse, stageSince } from "./history.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

const NOW = new Date(Date.UTC(2026, 10, 2, 12));
const day = (n: number, h = 0) => new Date(Date.UTC(2026, 10, 2) + n * 86_400_000 + h * 3_600_000);
let n = 0;
function ev(type: EventType, daysAgo: number, over: Partial<EffectiveEvent> = {}): EffectiveEvent {
  n += 1;
  return {
    id: `e${n}`, gmailMessageId: `m${n}`, gmailThreadId: `t${n}`, occurredAt: day(-daysAgo, n % 20), outbound: false,
    senderName: "Careers Team", senderDomain: "acme.com", subject: "s", type, company: "Acme", role: "Intern",
    eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false, ...over,
  };
}
const opp = (events: EffectiveEvent[]) => buildOpportunities(events)[0];

test("a changed interview time reads as a reschedule; the old time is superseded, the new one current", () => {
  const items = annotateTimeline([
    ev("interview_scheduled", 5, { eventDate: day(2, 16), eventDateHasTime: true }),
    ev("interview_scheduled", 4, { eventDate: day(2, 14), eventDateHasTime: true }),
  ]);
  assert.deepEqual(items.map((i) => i.label), ["Interview scheduled", "Interview rescheduled"]);
  assert.deepEqual(items.map((i) => i.superseded), [true, false]);
  assert.deepEqual(items.map((i) => i.current), [false, true]);
});

test("the same time confirmed twice is a confirmation, not a reschedule", () => {
  const items = annotateTimeline([
    ev("interview_scheduled", 5, { eventDate: day(2, 14) }),
    ev("interview_scheduled", 4, { eventDate: day(2, 14) }),
  ]);
  assert.equal(items[1].label, "Interview confirmed");
  assert.equal(items[0].superseded, false);
});

test("repeat assessment mails are reminders until it is completed", () => {
  const items = annotateTimeline([ev("assessment", 9), ev("assessment", 6), ev("assessment_completed", 4), ev("assessment", 2)]);
  assert.deepEqual(items.map((i) => i.label), ["Assessment received", "Assessment reminder", "Assessment completed", "Assessment received"]);
  assert.equal(items[1].major, false);
});

test("stage duration starts at the first event of the current stage, ignoring neutral events", () => {
  const o = opp([ev("applied", 30), ev("assessment", 20), ev("interview_scheduled", 6), ev("user_reply", 5), ev("status_update", 3)]);
  assert.equal(o.stage, "interview");
  assert.equal(Math.round((NOW.getTime() - stageSince(o).getTime()) / 86_400_000), 6);
});

test("next moment is the nearest future date; past ones are ignored", () => {
  const o = opp([
    ev("assessment", 20, { eventDate: day(-14) }),
    ev("interview_scheduled", 3, { eventDate: day(2, 14), eventDateHasTime: true }),
  ]);
  const next = nextMoment(o, NOW)!;
  assert.equal(next.label, "Interview");
  assert.equal(next.date.getTime(), day(2, 14).getTime());
  assert.equal(nextMoment(opp([ev("applied", 3)]), NOW), null);
});

test("people: real names only, newest first, never mailers or the company", () => {
  const o = opp([
    ev("applied", 10, { senderName: "Acme Hiring Team" }),
    ev("recruiter_outreach", 8, { senderName: "Maya Chen" }),
    ev("interview_invite", 4, { senderName: "Lauren Williams" }),
    ev("status_update", 3, { senderName: "no-reply@acme.com" }),
    ev("status_update", 2, { senderName: "Maya Chen" }),
  ]);
  assert.deepEqual(peopleFor(o), ["Maya Chen", "Lauren Williams"]);
});

test("pulse counts active opportunities per stage in funnel order", () => {
  const a = buildOpportunities([
    { ...ev("applied", 20), company: "A" }, { ...ev("applied", 18), company: "B" },
    { ...ev("assessment", 10), company: "C" }, { ...ev("rejection", 5), company: "D" },
  ]);
  const p = pulse(a);
  assert.deepEqual(p.map((x) => `${x.stage}:${x.count}`), ["applied:2", "recruiter:0", "assessment:1", "interview:0", "offer:0"]);
});
