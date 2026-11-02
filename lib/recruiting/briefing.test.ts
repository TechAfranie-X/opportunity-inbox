import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefing, describeAction, recentChanges } from "./briefing.ts";
import { daysBetween, relativeDay } from "./format.ts";
import type { ActionItem, EffectiveEvent, EventType, Opportunity } from "./types.ts";

const NOW = new Date(Date.UTC(2026, 10, 2, 12, 0));
const day = (n: number) => new Date(Date.UTC(2026, 10, 2) + n * 86_400_000);

function action(over: Partial<ActionItem>): ActionItem {
  return {
    id: "a", kind: "upcoming_interview", opportunityKey: "k", company: "Acme", role: "Intern", title: "t", reason: "r",
    due: null, dueHasTime: false, bucket: "soon", priority: 50, sourceThreadId: "t", ...over,
  };
}

test("an interview in two days needs you; one in five days is coming up", () => {
  const b = buildBriefing([], [
    action({ id: "near", due: day(2) }),
    action({ id: "far", due: day(5) }),
    action({ id: "quiet", bucket: "worth_a_look", kind: "follow_up" }),
    action({ id: "late", bucket: "overdue", kind: "schedule_interview" }),
  ], NOW);
  assert.deepEqual(b.needsYou.map((a) => a.id).sort(), ["late", "near"]);
  assert.deepEqual(b.comingUp.map((a) => a.id), ["far"]);
  assert.deepEqual(b.waiting.map((a) => a.id), ["quiet"]);
});

test("the briefing keeps the incoming priority order inside each section", () => {
  const b = buildBriefing([], [action({ id: "1", bucket: "today" }), action({ id: "2", bucket: "overdue" })], NOW);
  assert.deepEqual(b.needsYou.map((a) => a.id), ["1", "2"]);
});

test("relative day wording", () => {
  assert.equal(relativeDay(NOW, day(0)), "today");
  assert.equal(relativeDay(NOW, day(1)), "tomorrow");
  assert.equal(relativeDay(NOW, day(3)), "in 3 days");
  assert.equal(relativeDay(NOW, day(-1)), "yesterday");
  assert.equal(relativeDay(NOW, day(-9)), "9 days ago");
  assert.equal(relativeDay(NOW, day(-21)), "3 weeks ago");
  assert.equal(daysBetween(NOW, day(-3)), -3);
});

test("describeAction writes plain headlines and only flags past/today dates as critical", () => {
  const soon = describeAction(action({ due: day(2), dueHasTime: true }), NOW);
  assert.equal(soon.headline, "Interview with Acme");
  assert.equal(soon.relative, "in 2 days");
  assert.equal(soon.critical, false);
  assert.match(soon.when ?? "", /Wednesday, November 4 at 12:00 AM/);
  assert.equal(describeAction(action({ due: day(0) }), NOW).critical, true);
  assert.equal(describeAction(action({ kind: "assessment_deadline", bucket: "overdue", due: day(-1) }), NOW).critical, true);
});

function ev(type: EventType, daysAgo: number, outbound = false): EffectiveEvent {
  return {
    id: `${type}${daysAgo}`, gmailMessageId: `${type}${daysAgo}`, gmailThreadId: "t", occurredAt: day(-daysAgo), outbound,
    senderName: "x", senderDomain: "x.com", subject: "s", type, company: "Acme", role: null, eventDate: null,
    eventDateHasTime: false, dateKind: null, confidence: 1, signals: [], corrected: false,
  };
}
const opp = (key: string, events: EffectiveEvent[]): Opportunity => ({
  key, company: key, role: null, stage: "applied", outcome: null, status: "active", firstActivityAt: events[0].occurredAt,
  lastActivityAt: events[events.length - 1].occurredAt, events, needsReview: false,
});

test("recent changes: one per opportunity, inbound only, last 7 days, newest first", () => {
  const changes = recentChanges([
    opp("A", [ev("applied", 20), ev("interview_scheduled", 2)]),
    opp("B", [ev("applied", 1), ev("user_reply", 0, true)]),
    opp("C", [ev("applied", 30)]),
    opp("D", [ev("status_update", 1)]),
  ], NOW);
  assert.deepEqual(changes.map((c) => `${c.company}:${c.label}`), ["B:Applied", "A:Interview scheduled"]);
});
