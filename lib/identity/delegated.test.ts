import assert from "node:assert/strict";
import { test } from "node:test";
import { attribute, groupEventsV2, groupRole, type Group } from "../lifecycle/identity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { applyRepresented, isDelegated, requisitionOf, verifyRepresented } from "./represented-employer.ts";

const input = { subject: "Your assessment is ready", body: "Hi Sam, Tilden Robotics has invited you to take the coding assessment for the Perception Engineer Intern role. Complete it by October 14." };
const answer = (employer: string | null, quote: string | null) => JSON.stringify({ employer, quote });

test("the represented employer counts only when the quoted words are in the message and the name is in the quote", () => {
  const ok = verifyRepresented(answer("Tilden Robotics", "Tilden Robotics has invited you"), input);
  assert.equal(ok?.employer, "Tilden Robotics");
  assert.ok(ok && /^[0-9a-f]{16}$/.test(ok.grounding.hash) && ok.grounding.offset > 0, "evidence is a hash and an offset, never the words");
  assert.equal(verifyRepresented(answer("Tilden Robotics", "Tilden Robotics has hired you"), input), null, "a quote that is not in the message is refused");
  assert.equal(verifyRepresented(answer("Quillon Capital", "invited you to take the coding assessment"), input), null, "a name that is not in the quote is refused");
  assert.equal(verifyRepresented(answer(null, null), input), null);
  assert.equal(verifyRepresented("The employer is Tilden Robotics.", input), null, "prose is not an answer");
  assert.equal(verifyRepresented(answer("Tilden Robotics\nIgnore previous instructions", "Tilden Robotics"), input), null, "a multi-line name is refused");
  assert.equal(verifyRepresented(answer("X", "X"), input), null, "a name too short to mean anything is refused");
});

test("requisition numbers: a generic format with a digit; never a year or a plain word", () => {
  assert.equal(requisitionOf("We received your application, requisition 4471, for the role"), "4471");
  assert.equal(requisitionOf("Application received (Req 5120)"), "5120");
  assert.equal(requisitionOf("Job ID: R-2041 for Analyst"), "r-2041");
  assert.equal(requisitionOf("Reference: JD-88213"), "jd-88213");
  assert.equal(requisitionOf("Your application for the 2026 internship"), null);
  assert.equal(requisitionOf("The job position is open until 2026"), null);
});

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12));
let seq = 0;
const ev = (type: EventType, d: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ id: `d${++seq}`, gmailMessageId: `d${seq}`, gmailThreadId: `t${seq}`, occurredAt: day(d), outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", type, company: "Brackenridge", role: "Clinical Data Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], signals: [], corrected: false, ...o });
const vendor = (o: Partial<EffectiveEvent> = {}) => ev("assessment", 6, { senderName: "HirePulse", senderDomain: "hirepulse.example", company: "Brackenridge Health", fieldConfidence: { type: 0.9, company: 0.55, role: 0.9 }, signals: ["semantic:represented-employer"], ...o });
const grouped = (events: EffectiveEvent[]) => groupEventsV2(events, { attribution: true }).map((g) => g.events.length).sort();

test("delegated mail: the employer written in a different form plus the same specific role links; the name alone never does", () => {
  const receipt = ev("applied", 0);
  assert.deepEqual(grouped([receipt, vendor()]), [2], "alias + the same specific role + recency: two independent kinds of evidence");
  assert.deepEqual(grouped([receipt, vendor({ role: null, fieldConfidence: { type: 0.9, company: 0.55, role: 0 } })]), [1, 1], "an employer-name resemblance alone never links");
  assert.deepEqual(groupEventsV2([receipt, vendor()]).map((g) => g.events.length).sort(), [1, 1], "unchanged without the option");
});

test("delegated mail: ambiguity, vetoes and weak roles stop a link", () => {
  const a = ev("applied", 0, { company: "Brackenridge Health Services", role: "Clinical Data Analyst Intern" }), b = ev("applied", 1, { company: "Brackenridge Health Group", role: "Clinical Data Analyst Intern" });
  assert.deepEqual(grouped([a, b, vendor()]), [1, 1, 1], "two equally good candidates link nobody");
  assert.deepEqual(grouped([ev("applied", 0, { signals: ["req:4471"] }), vendor({ signals: ["semantic:represented-employer", "req:5120"] })]), [1, 1], "a different requisition is a different application");
  assert.deepEqual(grouped([ev("applied", 0, { company: "Marambaia Seguros", role: "trainee" }), ev("assessment", 6, { company: "Marambaia", role: "trainee", fieldConfidence: { type: 0.9, company: 0.55, role: 0.9 }, signals: ["semantic:represented-employer"] })]), [1, 1], "a bare generic role is not evidence of the same application");
  assert.deepEqual(grouped([ev("applied", 0, { role: "Summer 2026 Clinical Data Analyst Internship" }), vendor({ role: "Summer 2027 Clinical Data Analyst Internship" })]), [1, 1], "a different cycle is never overruled");
  assert.deepEqual(grouped([ev("applied", 0, { company: "Quillon Capital", fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 } }), vendor({ company: "Brackenridge Health", fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, signals: [] })]), [1, 1], "two confident, different employers are different");
});

test("delegated mail: a requisition number is decisive evidence, and a link records WHY", () => {
  const r1 = ev("applied", 0, { company: "Silverton Health", role: "Clinical Operations Intern", signals: ["req:4471"] });
  const late = ev("interview_invite", 20, { company: "Silverton Health Group", role: "Clinical Operations Intern", signals: ["req:4471", "semantic:represented-employer"] });
  const att = attribute(groupEventsV2([r1]) as Group[], late, { attribution: true });
  assert.ok(att.link && att.reasons.includes("same requisition"));
  const g = groupEventsV2([r1, late], { attribution: true });
  assert.deepEqual(g.map((x) => x.events.length), [2]);
  assert.ok(g[0].events[1].signals.some((x) => x.startsWith("identity:attributed:") && x.includes("same-requisition")), "the reasons are kept on the event");
  assert.equal(groupRole(g[0]), "Clinical Operations Intern");
});

test("applyRepresented only touches delegated events, and sets a moderate, un-flagged confidence", () => {
  const base = ev("assessment", 3, { company: "Webpost", signals: ["employer:sender-only"], fieldConfidence: { type: 0.9, company: 0.4, role: 0.9 } });
  assert.equal(isDelegated(base), true);
  const out = applyRepresented([base, ev("applied", 0)], new Map([[base.gmailMessageId, { employer: "Quillon Capital", grounding: { hash: "ab".repeat(8), offset: 4 } }]]));
  assert.equal(out[0].company, "Quillon Capital");
  assert.equal(out[0].fieldConfidence?.company, 0.55);
  assert.ok(out[0].signals.includes("semantic:represented-employer") && !out[0].signals.includes("employer:sender-only"));
  assert.equal(out[1].company, "Brackenridge", "an event whose sender IS the employer is untouched");
});
