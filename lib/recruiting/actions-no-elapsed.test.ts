import assert from "node:assert/strict";
import test from "node:test";
import { buildActions } from "./actions.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

delete process.env.ELAPSED_NUDGES;
const NOW = new Date(Date.UTC(2026, 10, 2, 9, 0));
const DAY = 86_400_000;
let n = 0;
const ev = (type: EventType, daysAgo: number, over: Partial<EffectiveEvent> = {}): EffectiveEvent => { n += 1; return { id: `e${n}`, gmailMessageId: `m${n}`, gmailThreadId: `t${n}`, occurredAt: new Date(NOW.getTime() - daysAgo * DAY), outbound: false, senderName: "x", senderDomain: "acme.com", subject: "s", type, company: "Acme", role: "Software Engineer Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false, ...over }; };
const run = (events: EffectiveEvent[]) => buildActions(buildOpportunities(events), NOW);

test("silence alone never creates a task: no follow-up, check-in or 'quiet' suggestion from elapsed time", () => {
  for (const age of [3, 20, 30, 70, 120]) assert.deepEqual(run([ev("applied", age)]), [], `applied ${age} days ago`);
  assert.deepEqual(run([ev("interview_scheduled", 14, { eventDate: new Date(NOW.getTime() - 14 * DAY), eventDateHasTime: true })]).map((x) => x.kind), [], "interview two weeks ago with no word");
  assert.deepEqual(run([ev("applied", 40), ev("user_reply", 20, { outbound: true })]), [], "you wrote and nobody answered");
});

test("evidence-backed tasks remain: an unanswered invitation, a dated assessment", () => {
  assert.ok(run([ev("interview_invite", 1)]).some((x) => x.kind === "schedule_interview"));
  assert.ok(run([ev("assessment", 2, { eventDate: new Date(NOW.getTime() + 3 * DAY), dateKind: "deadline" })]).some((x) => x.kind === "assessment_deadline"));
});
