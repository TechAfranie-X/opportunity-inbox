import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpportunities } from "../recruiting/opportunity.ts";
import type { EffectiveEvent, EventType, Opportunity } from "../recruiting/types.ts";
import { reconstructJourney } from "./journey.ts";

const base = { outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", company: "Acme", role: "Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], corrected: false } as const;
let n = 0;
const ev = (type: EventType, day: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ ...base, id: `j${++n}`, gmailMessageId: `j${n}aaaaaaaaaaaa`, gmailThreadId: `t${n}`, type, occurredAt: new Date(Date.UTC(2026, 8, day, 12)), signals: [], ...o });
const ctx = { attribution: true, distinctThreadReceipts: true, weakEmployerThreads: true, confirmEndings: true, borrowedCycle: true, cycleEnded: true };
const unplace = (opps: Opportunity[], e: EffectiveEvent): Opportunity[] => opps.flatMap((o) => { const mine = o.events.find((x) => x.gmailMessageId === e.gmailMessageId); return mine ? [{ ...o, events: o.events.filter((x) => x !== mine) }, { ...o, key: `${o.key}~u`, events: [mine] }] : [o]; });

test("one email: an unplaced message finds its application from the rest of the evidence (role named, thread, chronology) and states the journey", () => {
  const ux = ev("applied", 1, { role: "Internship - UX Design", gmailThreadId: "A", subject: "Application received (62217)" });
  const dig = ev("applied", 2, { role: "Internship - Digital", gmailThreadId: "B", subject: "Application received (62240)" });
  const asmt = ev("assessment", 5, { role: "Internship - Digital", gmailThreadId: "B", subject: "Your assessment" });
  const rej = ev("rejection", 20, { role: "Internship", gmailThreadId: "C", signals: ["role:named:Internship - Digital"] });
  const opps = buildOpportunities([ux, dig, asmt, rej], undefined, undefined, ctx);
  const j = reconstructJourney(rej.gmailMessageId, { opportunities: unplace(opps, rej), ctx })!;
  assert.equal(j.decision, "resolved");
  assert.ok(j.application!.role!.includes("Digital"));
  assert.deepEqual(j.timeline.map((t) => t.type), ["applied", "assessment", "rejection"]);
  assert.ok(j.misplaced, "the investigation moved the lone message to its application");
});

test("a receipt cannot continue an application that already has its own receipt; an application that had already ended cannot take a new interview", () => {
  const a = ev("applied", 1, { role: "Software Engineer", gmailThreadId: "A", subject: "Application received" });
  const b = ev("applied", 6, { role: "Software Engineer", gmailThreadId: "B", subject: "Application received" });
  const opps = buildOpportunities([a, b], undefined, undefined, ctx);
  const j = reconstructJourney(b.gmailMessageId, { opportunities: opps, ctx })!;
  assert.equal(j.decision, "resolved");
  assert.equal(j.misplaced, false, "two receipts are two applications");
  const rej = ev("rejection", 3, { role: "Data Intern", gmailThreadId: "X", company: "Other" });
  const late = ev("interview_invite", 20, { role: "Data Intern", gmailThreadId: "Y", company: "Other" });
  const j2 = reconstructJourney(late.gmailMessageId, { opportunities: unplace(buildOpportunities([ev("applied", 1, { role: "Data Intern", company: "Other", gmailThreadId: "Z" }), rej], undefined, undefined, ctx), late).concat(buildOpportunities([late], undefined, undefined, ctx)), ctx });
  assert.ok(j2, "the message is found");
});

test("when evidence cannot separate two same-role applications the investigation says so and asks one precise question", () => {
  const a = ev("applied", 1, { role: "Software Engineer", gmailThreadId: "A", company: "Dup" });
  const b = ev("applied", 2, { role: "Software Engineer", gmailThreadId: "B", company: "Dup" });
  const lone = ev("status_update", 10, { role: "Software Engineer", gmailThreadId: "C", company: "Dup" });
  const opps = [...buildOpportunities([a, b], undefined, undefined, ctx), ...buildOpportunities([lone], undefined, undefined, ctx)];
  const j = reconstructJourney(lone.gmailMessageId, { opportunities: opps, ctx })!;
  assert.notEqual(j.decision === "resolved" && j.misplaced, true, "it does not guess between equally plausible applications");
});
