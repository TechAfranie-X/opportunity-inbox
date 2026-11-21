import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceLifecycle } from "../lifecycle/reducer.ts";
import { buildOpportunities } from "./opportunity.ts";
import { confirmationConflictFor, withConfirmationConflicts } from "./confirmation-conflicts.ts";
import { buildReviewQueue } from "./review.ts";
import type { EffectiveEvent } from "./types.ts";

const base = { gmailThreadId: "t1", outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", company: "Alcon Test Co", role: "Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], signals: [], corrected: false } as const;
const ev = (id: string, type: EffectiveEvent["type"], day: number, extra: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ ...base, id, gmailMessageId: id, type, occurredAt: new Date(Date.UTC(2026, 5, day, 12)), ...extra });

test("an ending that rests on one uncorroborated reading is PROPOSED, not settled: the application stays active and visible", () => {
  const proposed = reduceLifecycle([ev("a", "applied", 1), ev("b", "rejection", 9, { signals: ["terminal:proposed"] })]);
  assert.deepEqual([proposed.status, proposed.closedBy, proposed.outcome, proposed.proposedEnding], ["active", null, null, { outcome: "rejected", eventId: "b" }]);
  const verified = reduceLifecycle([ev("a", "applied", 1), ev("b", "rejection", 9, { signals: ["terminal:verified"] })]);
  assert.deepEqual([verified.status, verified.closedBy, verified.proposedEnding], ["closed", "rejected", undefined], "a verified ending settles");
  assert.deepEqual([reduceLifecycle([ev("a", "applied", 1), ev("b", "rejection", 9)]).status], ["closed"], "an ending production produced settles exactly as before");
  const confirmed = reduceLifecycle([ev("a", "applied", 1), ev("b", "rejection", 9, { signals: ["terminal:proposed"], confirmed: true })]);
  assert.deepEqual([confirmed.status, confirmed.proposedEnding], ["closed", undefined], "a person's confirmation settles it");
  const later = reduceLifecycle([ev("a", "applied", 1), ev("b", "rejection", 9, { signals: ["terminal:proposed"] }), ev("c", "interview_invite", 12)]);
  assert.deepEqual([later.status, later.proposedEnding], ["active", undefined], "later progress drops the proposal");
  const o = buildOpportunities([ev("a", "applied", 1), ev("b", "rejection", 9, { signals: ["terminal:proposed"] })]);
  assert.equal(o[0].status, "active");
  assert.deepEqual(o[0].proposedEnding, { outcome: "rejected", eventId: "b" });
  assert.equal(o[0].closureProposed, undefined);
});

test("a plain confirmation that a later reading disagrees with becomes a Review question and is never overridden", () => {
  const confirmed = ev("c1", "status_update", 5, { confirmed: true });
  assert.match(confirmationConflictFor(confirmed, { type: "rejection", recruiting: true })!, /You confirmed this message as status update, but the latest reading of it says a rejection/);
  assert.equal(confirmationConflictFor(confirmed, { type: "status_update", recruiting: true }), null, "agreement is silent");
  assert.equal(confirmationConflictFor(confirmed, { type: "interview_invite", recruiting: true }), null, "only consequential disagreements are asked about");
  assert.equal(confirmationConflictFor(confirmed, { type: "rejection", recruiting: false }), null, "a reading that says it is not recruiting mail is not an ending");
  assert.equal(confirmationConflictFor({ ...confirmed, corrected: true }, { type: "rejection", recruiting: true }), null, "an explicit edit is a decision, not a vouching");
  assert.equal(confirmationConflictFor({ ...confirmed, confirmed: false }, { type: "rejection", recruiting: true }), null, "unconfirmed events are asked about by the ordinary review path");
  const opps = withConfirmationConflicts(buildOpportunities([ev("a", "applied", 1), confirmed]), new Map([["c1", { type: "rejection", recruiting: true }]]));
  assert.equal(opps[0].status, "active", "the application is NOT closed by the disagreeing reading: the confirmation stands");
  const queue = buildReviewQueue(opps);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].tier, "important");
  assert.equal(queue[0].event.confirmed, true);
});
