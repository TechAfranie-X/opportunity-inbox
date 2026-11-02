import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefing } from "./briefing.ts";
import { annotateTimeline, peopleFor } from "./history.ts";
import { buildPresentationMailbox, buildPresentationWorkspace } from "./presentation-data.ts";

test("the presentation data is deterministic: two builds are identical", () => {
  const a = JSON.stringify(buildPresentationWorkspace().opportunities.map((o) => [o.key, o.stage, o.events.length]));
  const b = JSON.stringify(buildPresentationWorkspace().opportunities.map((o) => [o.key, o.stage, o.events.length]));
  assert.equal(a, b);
});

test("the story the demo relies on holds: one thing needs you, and it is the interview", () => {
  const w = buildPresentationWorkspace();
  const briefing = buildBriefing(w.opportunities, w.actions, w.now);
  assert.equal(briefing.needsYou.length, 1);
  assert.equal(briefing.needsYou[0].kind, "upcoming_interview");
  assert.equal(briefing.needsYou[0].opportunityKey, w.heroKey);
  assert.ok(briefing.comingUp.length >= 2, "the agenda has something in it");
  const hero = w.opportunities.find((o) => o.key === w.heroKey)!;
  assert.equal(hero.stage, "interview");
  assert.deepEqual(peopleFor(hero, 1), ["Priya Natarajan"]);
});

test("the rich opportunity is twelve emails with a reschedule and an updated offer", () => {
  const w = buildPresentationWorkspace();
  const rich = w.opportunities.find((o) => o.key === w.historyKey)!;
  assert.equal(rich.events.length, 12);
  assert.equal(rich.stage, "offer");
  const labels = annotateTimeline(rich.events).map((i) => i.label);
  assert.ok(labels.includes("Interview rescheduled"));
  assert.ok(labels.includes("Offer updated"));
});

test("every stage in the pipeline tour has at least one opportunity", () => {
  const w = buildPresentationWorkspace();
  for (const stage of ["applied", "assessment", "interview", "offer"] as const) {
    assert.ok(w.opportunities.some((o) => o.status === "active" && o.stage === stage), stage);
  }
});

test("all names are fictional: no real inbox identifiers leak into the mailbox", () => {
  const blob = JSON.stringify(buildPresentationMailbox());
  assert.ok(!/gmail\.com/i.test(blob));
  assert.ok(!/afrane|aphranie/i.test(blob));
});
