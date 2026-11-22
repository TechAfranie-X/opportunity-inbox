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

test("the whole conversation moves: a sent reply in the same thread travels with the late incoming message", () => {
  const a26 = ev("applied", 1, 1, { role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD" });
  const rej = ev("rejection", 3, 3, { role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD" });
  const a27 = ev("applied", 9, 5, { role: "Software Engineer, Intern (Winter 2027)", gmailThreadId: "NEW" });
  const asmt = ev("assessment", 9, 14, { role: "Software Engineer, Intern (Winter 2027)", gmailThreadId: "NEW" });
  const lateIn = ev("status_update", 10, 4, { role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD", signals: ["role-inherited", "reply-in-recruiting-thread"] });
  const lateOut = ev("user_reply", 10, 5, { outbound: true, role: "Software Engineering Intern (Summer 2026)", gmailThreadId: "OLD" });
  const all = [a26, rej, a27, asmt, lateIn, lateOut];
  const moves = plannedMoves(buildOpportunities(all, undefined, undefined, ctx));
  assert.deepEqual(moves.map((m) => m.eventId).sort(), [lateIn.id, lateOut.id].sort());
  const after = buildOpportunities(applyMoves(all, moves), undefined, undefined, ctx);
  const home = after.find((o) => o.events.some((e) => e.id === a27.id))!;
  assert.ok(home.events.some((e) => e.id === lateIn.id) && home.events.some((e) => e.id === lateOut.id));
  assert.ok(!after.find((o) => o.events.some((e) => e.id === a26.id))!.events.some((e) => e.id === lateOut.id), "no antecedent left behind in the rejected 2026 application");
});

import { terminalFragmentMoves } from "./reattach.ts";
test("a lone terminal message confirming an ended sibling is attached to it; a distinct application is not", () => {
  const a = ev("applied", 1, 1, { role: "Fellowship Alpha", gmailThreadId: "A" }), rej1 = ev("rejection", 1, 20, { role: "Fellowship Alpha", gmailThreadId: "A" });
  const rej2 = ev("rejection", 2, 3, { role: "Fellowship Alpha", gmailThreadId: "B" }); // 14 days after: the same ending, said again
  const far = ev("rejection", 6, 3, { role: "Fellowship Alpha", gmailThreadId: "C" }); // months later: a new cycle
  const opps = buildOpportunities([a, rej1, rej2, far]);
  const moves = terminalFragmentMoves(opps);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].eventId, opps.flatMap((o) => o.events).find((e) => e.gmailMessageId === rej2.gmailMessageId)!.id);
});
