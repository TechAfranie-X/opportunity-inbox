import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunities } from "./opportunity.ts";
import { attentionCount, buildReviewQueue } from "./review.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let n = 0;
const ev = (company: string | null, type: EventType, daysAgo: number, over: Partial<EffectiveEvent> = {}): EffectiveEvent => ({
  id: `e${++n}`, gmailMessageId: `m${n}`, gmailThreadId: `t-${company}-${type}-${n}`, occurredAt: day(daysAgo), outbound: false, senderName: "x", senderDomain: "x.example", subject: "s",
  type, company, role: "Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.4, fieldConfidence: { type: 0.3, company: 0.3, role: 0.4 }, reviewReasons: ["type: unsure"], signals: [], corrected: false, ...over,
});

test("the review queue ranks by impact on live recruiting, not by arrival", () => {
  const housekeeping = ev("OldCo", "follow_up", 90); // old, quiet follow-up
  const offer = ev("OfferCo", "offer", 3); // an offer on an active opportunity
  const interview = ev("TalkCo", "interview_scheduled", 2, { eventDate: new Date(NOW.getTime() + 2 * 86_400_000), dateKind: "scheduled" });
  const goodbye = ev("GhostCo", "follow_up", 4, { reviewReasons: ["conflict: the wording reads like a goodbye, but it was read as \"follow up\""] });
  const opportunities = buildOpportunities([housekeeping, offer, interview, goodbye]);
  const queue = buildReviewQueue(opportunities, undefined, [], NOW);
  const order = queue.map((i) => i.company);
  assert.ok(order.indexOf("OldCo") === order.length - 1, "housekeeping last");
  assert.ok(queue.find((i) => i.company === "OldCo")!.tier === "routine");
  for (const c of ["OfferCo", "TalkCo", "GhostCo"]) assert.equal(queue.find((i) => i.company === c)!.tier, "important", c);
  assert.equal(queue.find((i) => i.company === "GhostCo")!.why, "Might be a rejection");
  assert.ok(queue.every((i) => i.why.length > 0 && Number.isFinite(i.impact)));
});

test("weak near misses rank last and are never counted", () => {
  const strong = ev(null, "status_update", 1, { signals: ["near-miss"], reviewReasons: ["possible: this looks like part of a hiring process but we did not recognise what it says"] });
  const weak = ev(null, "status_update", 1, { signals: ["near-miss", "near-miss:weak"], reviewReasons: ["possible: this looks like part of a hiring process but we did not recognise what it says"] });
  const real = ev("Acme", "applied", 5);
  const queue = buildReviewQueue(buildOpportunities([real]), undefined, [strong, weak], NOW);
  assert.equal(queue[queue.length - 1].weak, true);
  assert.equal(attentionCount(queue), queue.filter((i) => !i.weak && i.tier === "important").length, "only important, non-weak reviews are counted");
  assert.ok(attentionCount(queue) < queue.length, "housekeeping and weak suggestions never inflate the number");
  assert.ok(queue.find((i) => i.possible && !i.weak)!.impact > 0);
});
