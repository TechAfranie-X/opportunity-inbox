import assert from "node:assert/strict";
import test from "node:test";
import { buildActions } from "./actions.ts";
import { extractEvent } from "./extract.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, EventType, RecruitingEmail } from "./types.ts";

const NOW = new Date(Date.UTC(2026, 10, 2, 9, 0));
const DAY = 86_400_000;
let n = 0;
function ev(type: EventType, daysAgo: number, over: Partial<EffectiveEvent> = {}): EffectiveEvent {
  n += 1;
  return {
    id: `e${n}`, gmailMessageId: `m${n}`, gmailThreadId: `t${n}`,
    occurredAt: new Date(NOW.getTime() - daysAgo * DAY), outbound: false, senderName: "x", senderDomain: "acme.com",
    subject: "s", type, company: "Acme", role: "Software Engineer Intern",
    eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false, ...over,
  };
}
const dayOffset = (d: number) => new Date(Date.UTC(2026, 10, 2) + d * DAY);
const run = (events: EffectiveEvent[]) => buildActions(buildOpportunities(events), NOW);

test("an assessment deadline long past is history, not an overdue action", () => {
  assert.equal(run([ev("assessment", 120, { eventDate: dayOffset(-113), dateKind: "deadline" })]).length, 0);
});

test("an assessment just past its deadline is still flagged (extension window)", () => {
  const a = run([ev("assessment", 10, { eventDate: dayOffset(-2), dateKind: "deadline" })]);
  assert.equal(a[0]?.kind, "assessment_deadline");
  assert.equal(a[0]?.bucket, "overdue");
});

test("an expiry notice is read as the deadline, so it stops nagging", () => {
  const email: RecruitingEmail = {
    id: "x", threadId: "tx", from: "CodeSignal <noreply@codesignal.com>", subject: "Request from Acme has expired.",
    receivedAt: new Date(Date.UTC(2026, 8, 1)), outbound: false, bodyText: "Your CodeSignal assessment link has expired.",
  };
  const e = extractEvent(email)!;
  assert.equal(e.type, "assessment");
  assert.ok(e.eventDate, "expiry date recorded");
  assert.equal(run([{ ...e, id: "i", corrected: false }]).length, 0);
});

test("an offer followed by later activity (accepted) does not nag; a fresh unanswered one does", () => {
  assert.equal(run([ev("offer", 60), ev("status_update", 55)]).length, 0);
  const fresh = run([ev("offer", 2)]);
  assert.equal(fresh[0]?.kind, "offer_decision");
});

test("an offer whose deadline passed more than a week ago stops appearing", () => {
  assert.equal(run([ev("offer", 90, { eventDate: dayOffset(-80), dateKind: "deadline" })]).length, 0);
  assert.equal(run([ev("offer", 90, { eventDate: dayOffset(-3), dateKind: "deadline" })])[0]?.kind, "offer_decision");
});

test("a fresh interview invite is overdue, an old one becomes a quiet nudge", () => {
  assert.equal(run([ev("interview_invite", 4)])[0].bucket, "overdue");
  assert.equal(run([ev("interview_invite", 20)])[0].bucket, "worth_a_look");
});

test("quiet-application nudges are bounded to the 14-45 day window and ranked around three weeks", () => {
  const a = run([ev("applied", 5, { company: "A" }), ev("applied", 21, { company: "B" }), ev("applied", 44, { company: "C" }), ev("applied", 70, { company: "D" })]);
  assert.deepEqual(a.map((x) => x.company), ["B", "C"]);
});
