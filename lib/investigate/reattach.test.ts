import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpportunities } from "../recruiting/opportunity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { applyMoves, plannedMoves } from "./reattach.ts";

const base = { outbound: false, senderName: "Lauren", senderDomain: "acme.example", subject: "Update", company: "Acme", role: "Software Engineering Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], corrected: false } as const;
let n = 0;
const ev = (type: EventType, month: number, day: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ ...base, id: `r${++n}`, gmailMessageId: `r${n}aaaaaaaaaaaa`, gmailThreadId: `t${n}`, type, occurredAt: new Date(Date.UTC(2026, month, day, 12)), signals: [], ...o });
const ctx = { attribution: true, distinctThreadReceipts: true, weakEmployerThreads: true, confirmEndings: true, borrowedCycle: true, cycleEnded: true };

test("a late reply in an old thread that landed in an application ended months earlier is moved to the open application it belongs to; a confirmed one is never moved", () => {
  const a26 = ev("applied", 1, 1, { role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD" });
  const rej = ev("rejection", 3, 3, { role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD" });
  const a27 = ev("applied", 9, 5, { role: "Software Engineer, Intern (Winter 2027)", gmailThreadId: "NEW" });
  const asmt = ev("assessment", 9, 14, { role: "Software Engineer, Intern (Winter 2027)", gmailThreadId: "NEW" });
  const late = ev("status_update", 10, 4, { role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD", signals: ["role-inherited", "reply-in-recruiting-thread"] });
  const opps = buildOpportunities([a26, rej, a27, asmt, late], undefined, undefined, ctx);
  const home = opps.find((o) => o.events.some((e) => e.id === late.id))!;
  assert.equal(home.status, "closed", "the stray reply sits in the ended 2026 application");
  const moves = plannedMoves(opps);
  assert.equal(moves.length, 1);
  const again = buildOpportunities(applyMoves([a26, rej, a27, asmt, late], moves), undefined, undefined, ctx);
  const now = again.find((o) => o.events.some((e) => e.id === late.id))!;
  assert.ok(now.events.some((e) => e.id === a27.id), "it now sits with the 2027 application");
  assert.equal(again.find((o) => o.events.some((e) => e.id === a26.id))!.status, "closed");
  const keep = buildOpportunities([a26, rej, a27, asmt, { ...late, confirmed: true }], undefined, undefined, ctx);
  assert.equal(plannedMoves(keep).length, 0, "a person's confirmation is never moved");
});

test("with nothing contradicting the grouping, the pass changes nothing", () => {
  const a = ev("applied", 1, 1, { gmailThreadId: "A" }), b = ev("assessment", 1, 5, { gmailThreadId: "A" });
  assert.equal(plannedMoves(buildOpportunities([a, b], undefined, undefined, ctx)).length, 0);
});
