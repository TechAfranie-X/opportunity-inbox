import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpportunities } from "./opportunity.ts";
import { buildReviewQueue } from "./review.ts";
import { pending, priorityOf } from "./review-priority.ts";
import type { EffectiveEvent, EventType, Opportunity } from "./types.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const base = { gmailThreadId: "t1", outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", company: "Prio Co", role: "Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], signals: [], corrected: false } as const;
const ev = (id: string, type: EventType, day: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ ...base, id, gmailMessageId: id, type, occurredAt: new Date(Date.UTC(2026, 8, day, 12)), ...o });
const proposedEnd = (id: string, day: number) => ev(id, "rejection", day, { signals: ["terminal:proposed"] });

test("a proposed ending is a question only when something is pending; otherwise an optional suggestion", () => {
  const quiet = buildOpportunities([ev("a", "applied", 1), proposedEnd("b", 20)]);
  const q1 = buildReviewQueue(quiet, undefined, [], NOW, { prioritize: true });
  assert.equal(q1.length, 1);
  assert.equal(q1[0].kind, "proposed-ending");
  assert.equal(q1[0].tier, "routine", "a receipt-stage application with a proposed ending: a suggestion");
  const live = buildOpportunities([ev("a", "applied", 1), ev("i", "interview_scheduled", 5, { eventDate: new Date("2026-10-14T15:00:00Z") }), proposedEnd("b", 20)]);
  assert.equal(pending(live[0], NOW), true);
  const q2 = buildReviewQueue(live, undefined, [], NOW, { prioritize: true });
  assert.ok(q2.some((i) => i.kind === "proposed-ending" && i.tier === "important"), "an upcoming interview makes the proposal a decision");
  assert.equal(pending(buildOpportunities([ev("a", "applied", 1), ev("i", "interview_scheduled", 5, { eventDate: new Date("2026-09-20T15:00:00Z") })])[0], NOW), false, "a date that has passed is not pending");
});

test("without the option the queue is exactly what it was, and production events raise none of the new kinds", () => {
  const opps = buildOpportunities([ev("a", "applied", 1), ev("b", "rejection", 9)]);
  assert.deepEqual(buildReviewQueue(opps, undefined, [], NOW), buildReviewQueue(opps, undefined, [], NOW, { prioritize: false }));
  assert.equal(buildReviewQueue(opps, undefined, [], NOW).length, 0);
});

test("optional identity suggestions are never urgent; repeated questions about one application are one question", () => {
  const sug = ev("s", "status_update", 4, { signals: ["identity:suggest:a"] });
  const opps = buildOpportunities([ev("a", "applied", 1), sug]);
  const q = buildReviewQueue(opps, undefined, [], NOW, { prioritize: true });
  assert.ok(q.length >= 1 && q.every((i) => i.tier === "routine" && i.suggestion), "a suggestion about a routine message is collapsed and uncounted");
  const dup = buildOpportunities([ev("a", "applied", 1), ev("s1", "status_update", 4, { signals: ["identity:suggest:a"] }), ev("s2", "status_update", 5, { signals: ["identity:suggest:a"] })]);
  assert.equal(buildReviewQueue(dup, undefined, [], NOW, { prioritize: true }).length, 1, "folded");
  assert.ok((buildReviewQueue(dup, undefined, [], NOW, { prioritize: true })[0].similar ?? 0) >= 1);
});

test("competing evidence on a live application is a decision; a consequential unattributed message is a decision; the same on a closed application is not", () => {
  const item = (kind: "contradiction" | "ambiguous", type: EventType, o: Opportunity) => priorityOf({ event: ev("x", type, 3), opportunityKey: o.key, company: "Prio Co", role: null, reasons: ["r"], impact: 50, why: "", tier: "routine", kind }, o, NOW);
  const active = buildOpportunities([ev("a", "applied", 1)])[0], closed = buildOpportunities([ev("a", "applied", 1), ev("b", "rejection", 9)])[0];
  assert.equal(item("contradiction", "interview_invite", active), "decide");
  assert.equal(item("contradiction", "interview_invite", closed), "suggest");
  assert.equal(item("ambiguous", "rejection", active), "decide");
  assert.equal(item("ambiguous", "status_update", active), "suggest");
});
