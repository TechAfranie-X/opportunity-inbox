import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpportunities } from "../recruiting/opportunity.ts";
import { buildReviewQueue } from "../recruiting/review.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { investigate } from "./resolve.ts";

const base = { outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", company: "Acme", role: "Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.8, fieldConfidence: { type: 0.8, company: 0.8, role: 0.8 }, reviewReasons: [], corrected: false } as const;
let n = 0;
const ev = (type: EventType, day: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ ...base, id: `i${++n}`, gmailMessageId: `i${n}xxxxxxxx`, gmailThreadId: `t${n}`, type, occurredAt: new Date(Date.UTC(2026, 8, day, 12)), signals: [], ...o });

test("a type doubt is resolved only when the message's own facts say the same type, with the evidence named", () => {
  const receipt = ev("applied", 1, { signals: ["own:receipt"], reviewReasons: ["type: low confidence"] });
  const noFacts = ev("applied", 2, { reviewReasons: ["type: low confidence"], gmailThreadId: "x" });
  const res = investigate(buildOpportunities([receipt, noFacts]));
  assert.ok(res.has(receipt.id));
  assert.equal(res.get(receipt.id)!.evidence[0].kind, "own-application-receipt");
  assert.ok(!res.has(noFacts.id), "no independent fact, so it stays a question");
});

test("a person's correction or confirmation is never resolved away; a doubt with an unexplained second reason stays open", () => {
  const confirmed = ev("applied", 1, { signals: ["own:receipt"], reviewReasons: ["type: low confidence"], confirmed: true });
  const twoReasons = ev("applied", 2, { signals: ["own:receipt"], reviewReasons: ["type: low confidence", "role: weak evidence"], gmailThreadId: "y" });
  const res = investigate(buildOpportunities([confirmed, twoReasons]));
  assert.equal(res.size, 0);
});

test("an employer doubt is resolved by the subject naming the employer or a confident same-thread message", () => {
  const named = ev("applied", 1, { subject: "Thank you for applying to Acme", reviewReasons: ["company: weak evidence"] });
  const mate = ev("assessment", 2, { gmailThreadId: "T", fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 } });
  const doubt = ev("status_update", 3, { gmailThreadId: "T", subject: "Reminder", reviewReasons: ["company: weak evidence"], signals: [] });
  const res = investigate(buildOpportunities([named, mate, doubt]));
  assert.equal(res.get(named.id)?.evidence[0].kind, "subject-names-employer");
  assert.equal(res.get(doubt.id)?.evidence[0].kind, "same-thread-employer");
});

test("Review leaves resolved doubts out only with the investigator on, and keeps the rest", () => {
  const low = { confidence: 0.4, fieldConfidence: { type: 0.4, company: 0.8, role: 0.8 } };
  const receipt = ev("applied", 1, { signals: ["own:receipt"], reviewReasons: ["type: low confidence"], ...low });
  const open = ev("assessment", 2, { company: "Other", reviewReasons: ["type: low confidence"], ...low });
  const opps = buildOpportunities([receipt, open]);
  const now = new Date(Date.UTC(2026, 9, 1));
  const off = buildReviewQueue(opps, undefined, [], now, {});
  const on = buildReviewQueue(opps, undefined, [], now, { investigate: true });
  assert.ok(off.some((q) => q.event.id === receipt.id));
  assert.ok(!on.some((q) => q.event.id === receipt.id));
  assert.ok(on.some((q) => q.event.id === open.id));
});
