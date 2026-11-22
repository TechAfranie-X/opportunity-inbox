import assert from "node:assert/strict";
import test from "node:test";
import { buildAutonomousReview, dispositionOutside } from "./autonomy.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

const NOW = new Date(Date.UTC(2026, 10, 2, 9, 0));
const DAY = 86_400_000;
let n = 0;
const ev = (type: EventType, daysAgo: number, over: Partial<EffectiveEvent> = {}): EffectiveEvent => { n += 1; return { id: `e${n}`, gmailMessageId: `m${n}`, gmailThreadId: `t${n}`, occurredAt: new Date(NOW.getTime() - daysAgo * DAY), outbound: false, senderName: "x", senderDomain: "acme.com", subject: "s", type, company: "Acme", role: "Software Engineer Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false, ...over }; };

test("low model confidence alone is never a question: a doubtful plain update inside a journey is handled, with its reason", () => {
  const receipt = ev("applied", 20, { signals: ["own:receipt"] });
  const doubt = ev("status_update", 10, { confidence: 0.3, fieldConfidence: { type: 0.3, company: 0.9, role: 0.9 }, reviewReasons: ["type: low confidence"] });
  const r = buildAutonomousReview(buildOpportunities([receipt, doubt]), undefined, [], NOW);
  assert.equal(r.asks.length, 0);
  assert.ok(r.handled.some((h) => h.event.id === doubt.id && h.kind === "support" && h.why.length > 20));
});

test("messages outside every journey are set aside or kept as unassigned evidence, never a yes/no question", () => {
  const campaign = ev("applied", 5, { signals: ["class:marketing"] });
  const draft = ev("status_update", 5, { signals: ["class:draft"] });
  const receipt = ev("applied", 5, { company: null, signals: ["own:receipt"] });
  const programme = ev("status_update", 5, { company: null, signals: ["program:enrolled"] });
  const noFacts = ev("applied", 5, { company: "Somebody", signals: ["semantic:event"] });
  assert.equal(dispositionOutside(campaign).kind, "prospecting");
  assert.equal(dispositionOutside(draft).kind, "draft");
  assert.equal(dispositionOutside(receipt).kind, "unassigned");
  assert.equal(dispositionOutside(programme).kind, "unassigned");
  assert.equal(dispositionOutside(noFacts).kind, "noise");
  const r = buildAutonomousReview([], undefined, [campaign, draft, receipt, programme, noFacts], NOW);
  assert.equal(r.asks.length, 0);
  assert.equal(r.unassigned.length, 2);
  assert.equal(r.setAside.length, 3);
});

test("an ending nothing confirms is a question, and the question says what is missing, why Gmail cannot answer, and what depends on it", () => {
  const rec = ev("applied", 40, { signals: ["own:receipt"] });
  const end = ev("rejection", 3, { signals: ["terminal:proposed"], confidence: 0.6 });
  const r = buildAutonomousReview(buildOpportunities([rec, end]), undefined, [], NOW);
  for (const a of r.asks) { assert.ok(a.ask.missing.length > 10 && a.ask.whyNotResolved.length > 10 && a.ask.decision.length > 10); }
});
