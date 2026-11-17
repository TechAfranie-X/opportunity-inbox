import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunities } from "./opportunity.ts";
import { entityState, monogram, stageMilestones } from "./presentation.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

let n = 0;
const ev = (type: EventType, day: number, over: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ id: `e${++n}`, gmailMessageId: `m${n}`, gmailThreadId: "t", occurredAt: new Date(Date.UTC(2026, 10, day)), outbound: false, senderName: "x", senderDomain: "x.example", subject: "s", type, company: "Lyft", role: "Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.8, fieldConfidence: { type: 0.8, company: 0.8, role: 0.5 }, signals: [], corrected: false, ...over });

test("entity state distinguishes known, likely and unknown", () => {
  assert.equal(entityState(buildOpportunities([ev("applied", 1)])[0]), "known");
  assert.equal(entityState(buildOpportunities([ev("applied", 1, { fieldConfidence: { type: 0.8, company: 0.35, role: 0 } })])[0]), "likely", "a grounded name with weak evidence is shown, but marked");
  assert.equal(entityState(buildOpportunities([ev("applied", 1, { fieldConfidence: { type: 0.8, company: 0.35, role: 0 }, confirmed: true })])[0]), "known", "a person's word settles it");
  assert.equal(entityState({ company: null, events: [] }), "unknown");
});

test("monogram is deterministic and never pretends to be a logo", () => {
  assert.equal(monogram("Datadog"), "DA");
  assert.equal(monogram("Capital One"), "CO");
  assert.equal(monogram("Summit-ai"), "SA");
  assert.equal(monogram(null), "?");
});

test("stage milestones say how an opportunity got where it is", () => {
  const opp = buildOpportunities([ev("applied", 1), ev("recruiter_outreach", 5), ev("interview_invite", 9)])[0];
  const m = stageMilestones(opp);
  assert.deepEqual(m.map((x) => [x.stage, x.reached, x.current, x.at?.getUTCDate() ?? null]), [["applied", true, false, 1], ["recruiter", true, false, 5], ["assessment", true, false, null], ["interview", true, true, 9], ["offer", false, false, null]]);
  const skipped = stageMilestones(buildOpportunities([ev("applied", 1), ev("offer", 20)])[0]);
  assert.deepEqual(skipped.filter((x) => x.reached).map((x) => [x.stage, x.at !== null]), [["applied", true], ["recruiter", false], ["assessment", false], ["interview", false], ["offer", true]], "skipped stages are reached without a date");
  const closed = stageMilestones(buildOpportunities([ev("applied", 1), ev("interview_scheduled", 8), ev("rejection", 12)])[0]);
  assert.equal(closed.some((x) => x.current), false, "a closed opportunity is not 'here'");
  assert.equal(closed.filter((x) => x.reached).length, 4, "but it shows how far it got");
});
