import assert from "node:assert/strict";
import test from "node:test";
import { roleRelation } from "./company.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

let n = 0;
function ev(over: { type: EventType; company?: string | null; role?: string | null; day: number; thread?: string }): EffectiveEvent {
  n += 1;
  return {
    id: `e${n}`, gmailMessageId: `m${n}`, gmailThreadId: over.thread ?? `t${n}`,
    occurredAt: new Date(Date.UTC(2026, 0, 1) + over.day * 86_400_000),
    outbound: false, senderName: "x", senderDomain: "x.com", subject: "s",
    type: over.type, company: over.company === undefined ? "Acme" : over.company, role: over.role ?? null,
    eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false,
  };
}

test("role relations: match, generic and conflict", () => {
  assert.equal(roleRelation("Software Engineer", "Software Engineering Intern (Summer 2027)"), "match");
  assert.equal(roleRelation("Software Engineer", "Intern"), "generic");
  assert.equal(roleRelation(null, "Data Analyst"), "generic");
  assert.equal(roleRelation("2027 Internship", "JR1234567 Summer 2027 Intern"), "generic");
  assert.equal(roleRelation("Software Engineer", "Solution Engineer"), "conflict");
  assert.equal(roleRelation("Data Analyst", "Software Engineer"), "conflict");
});

test("a generic-role event joins the most recent opportunity at that company", () => {
  const opps = buildOpportunities([
    ev({ type: "applied", role: "Software Engineer", day: 0 }),
    ev({ type: "assessment", role: "Intern", day: 10 }),
    ev({ type: "interview_scheduled", role: null, day: 20 }),
  ]);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].events.length, 3);
});

test("two specific, different roles at one company stay separate", () => {
  const opps = buildOpportunities([
    ev({ type: "applied", role: "Software Engineer", day: 0 }),
    ev({ type: "applied", role: "Data Analyst", day: 1 }),
  ]);
  assert.equal(opps.length, 2);
});

test("a new application after a rejection starts a new opportunity, a neutral update does not", () => {
  const opps = buildOpportunities([
    ev({ type: "applied", role: "Solution Engineer", day: 0 }),
    ev({ type: "rejection", role: "Solution Engineer", day: 5, thread: "t-rej" }),
    ev({ type: "status_update", role: null, day: 6 }),
    ev({ type: "applied", role: "Intern", day: 8 }),
  ]);
  assert.equal(opps.length, 2);
  const closed = opps.find((o) => o.status === "closed")!;
  assert.equal(closed.events.length, 3, "rejection + neutral update stay together");
  assert.equal(opps.find((o) => o.status === "active")!.events[0].type, "applied");
});

test("generic-role events do not attach to an opportunity idle for more than 90 days", () => {
  const opps = buildOpportunities([
    ev({ type: "applied", role: "Software Engineer", day: 0 }),
    ev({ type: "applied", role: "Intern", day: 120 }),
  ]);
  assert.equal(opps.length, 2);
});

test("same thread always links, even across roles", () => {
  const opps = buildOpportunities([
    ev({ type: "applied", role: "Software Engineer", day: 0, thread: "same" }),
    ev({ type: "interview_invite", role: "Data Analyst", day: 3, thread: "same" }),
  ]);
  assert.equal(opps.length, 1);
});
