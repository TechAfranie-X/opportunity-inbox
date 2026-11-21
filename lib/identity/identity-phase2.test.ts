import assert from "node:assert/strict";
import { test } from "node:test";
import { groupEventsV2, type IdentityContext } from "../lifecycle/identity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { parseRoleAnswer, rolePairKey, type RoleVerdicts } from "./role-equivalence.ts";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 12));
let seq = 0;
const ev = (type: EventType, d: number, o: Partial<EffectiveEvent> = {}): EffectiveEvent => ({ id: `x${++seq}`, gmailMessageId: `x${seq}`, gmailThreadId: `t${seq}`, occurredAt: day(d), outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update", type, company: "Harborline", role: "Data Analyst Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], signals: [], corrected: false, ...o });
const sizes = (g: ReturnType<typeof groupEventsV2>) => g.map((x) => x.events.length).sort();
const verdicts = (a: string, b: string, v: "same" | "different"): RoleVerdicts => new Map([[rolePairKey(a, b), v]]);

test("role equivalence: 'same' joins differently-worded roles only with the Gmail thread behind it; 'different' always separates", () => {
  const A = "Mobile SWE Intern", B = "Software Engineering Intern (Mobile)";
  assert.deepEqual(sizes(groupEventsV2([ev("applied", 0, { role: A, gmailThreadId: "T" }), ev("interview_invite", 5, { role: B, gmailThreadId: "T" })])), [1, 1], "the token comparison alone cannot tell these are one job");
  const sameThread = [ev("applied", 0, { role: A, gmailThreadId: "T" }), ev("interview_invite", 5, { role: B, gmailThreadId: "T" })];
  const otherThread = [ev("applied", 0, { role: A, gmailThreadId: "T1" }), ev("interview_invite", 5, { role: B, gmailThreadId: "T2" })];
  assert.deepEqual(sizes(groupEventsV2(sameThread, { roleVerdicts: verdicts(A, B, "same") })), [2], "same thread plus a 'same' judgment joins them");
  assert.deepEqual(sizes(groupEventsV2(otherThread, { roleVerdicts: verdicts(A, B, "same") })), [1, 1], "a 'same' judgment alone does not merge two applications");
  const similar = [ev("applied", 0, { role: "Data Analyst Intern", gmailThreadId: "T" }), ev("assessment", 5, { role: "Data Analyst Intern II", gmailThreadId: "T" })];
  assert.deepEqual(sizes(groupEventsV2(similar, { roleVerdicts: verdicts("Data Analyst Intern", "Data Analyst Intern II", "different") })), [1, 1], "a 'different' judgment keeps them apart");
});

test("a cycle or programme conflict is never overruled by a role judgment", () => {
  const a = "Summer 2026 Analyst Internship", b = "Summer 2027 Analyst Internship";
  const ctx: IdentityContext = { roleVerdicts: verdicts(a, b, "same") };
  assert.deepEqual(sizes(groupEventsV2([ev("applied", 0, { role: a, gmailThreadId: "T" }), ev("interview_invite", 400, { role: b, gmailThreadId: "T" })], ctx)), [1, 1]);
});

test("weak employer names: a name that only names the sender does not stop a reply in the same thread joining its application", () => {
  const weak = { company: "Inbox-hub", fieldConfidence: { type: 0.9, company: 0.4, role: 0.9 }, signals: ["employer:sender-only"] };
  const events = [ev("applied", 0, { company: "Tessellate", gmailThreadId: "T" }), ev("interview_scheduled", 6, { ...weak, gmailThreadId: "T" })];
  assert.deepEqual(sizes(groupEventsV2(events)), [1, 1], "unchanged without the option");
  assert.deepEqual(sizes(groupEventsV2(events, { weakEmployerThreads: true })), [2]);
  const strongOther = [ev("applied", 0, { company: "Tessellate", gmailThreadId: "T" }), ev("interview_scheduled", 6, { company: "Quillon", gmailThreadId: "T" })];
  assert.deepEqual(sizes(groupEventsV2(strongOther, { weakEmployerThreads: true })), [1, 1], "a confidently different employer still separates them");
});

test("receipts: a role-less receipt in a different thread is another application; a repeat delivery in the same thread is not", () => {
  const r = (thread: string, d: number) => ev("applied", d, { role: null, fieldConfidence: { type: 0.9, company: 0.9, role: 0 }, gmailThreadId: thread });
  assert.deepEqual(sizes(groupEventsV2([r("A", 0), r("B", 0.1)], { distinctThreadReceipts: true })), [1, 1]);
  assert.deepEqual(sizes(groupEventsV2([r("A", 0), r("B", 0.1)])), [2], "unchanged without the option");
  assert.deepEqual(sizes(groupEventsV2([r("A", 0), r("A", 0.1)], { distinctThreadReceipts: true })), [2], "a duplicate delivery shares its thread");
});

test("ending confirmation: an employer's confirmation of a withdrawal joins the application only when the specific role matches", () => {
  const outbound = ev("withdrawn", 3, { outbound: true, gmailThreadId: "T" });
  const mk = (role: string) => [ev("applied", 0, { gmailThreadId: "T" }), outbound, ev("withdrawn", 4, { role, gmailThreadId: "T" })];
  assert.ok(sizes(groupEventsV2(mk("Data Analyst Intern"))).length > 1, "without the option the confirmation starts a new application");
  assert.deepEqual(sizes(groupEventsV2(mk("Data Analyst Intern"), { confirmEndings: true })), [3]);
  assert.ok(sizes(groupEventsV2(mk("Operations Research Intern"), { confirmEndings: true })).length > 1, "a different role is not the same application");
});

test("the model's role answer is parsed defensively", () => {
  assert.deepEqual([...parseRoleAnswer('[{"i":1,"same":true},{"i":2,"same":false}]', 2)], [[1, "same"], [2, "different"]]);
  assert.equal(parseRoleAnswer("I think they are the same", 1).size, 0, "prose is ignored");
  assert.equal(parseRoleAnswer('[{"i":9,"same":true},{"i":1,"same":"yes"}]', 2).size, 0, "unknown index and non-boolean are ignored");
  assert.equal(parseRoleAnswer("[not json", 1).size, 0);
});

test("one receipt per application holds for specific roles too: the same role received in a different Gmail thread is another application", () => {
  const r = (thread: string, d: number) => ev("applied", d, { gmailThreadId: thread });
  assert.deepEqual(sizes(groupEventsV2([r("A", 0), r("B", 1)], { distinctThreadReceipts: true })), [1, 1]);
  assert.deepEqual(sizes(groupEventsV2([r("A", 0), r("A", 0.1)], { distinctThreadReceipts: true })), [2], "a repeat delivery shares its thread");
  assert.deepEqual(sizes(groupEventsV2([r("A", 0), r("B", 1)])), [2], "unchanged without the option");
});

test("a requisition number is identity: the same number is one application, different numbers are two, whatever the wording", () => {
  const withReq = (id: string, d: number, thread: string) => ev("applied", d, { gmailThreadId: thread, signals: [`req:${id}`] });
  const a = withReq("4471", 0, "A"), b = withReq("5120", 0.2, "B");
  assert.deepEqual(sizes(groupEventsV2([a, b], { attribution: true })), [1, 1], "two numbers, two applications");
  const later = ev("interview_invite", 5, { gmailThreadId: "C", signals: ["req:4471"] });
  const g = groupEventsV2([a, b, later], { attribution: true });
  assert.deepEqual(g.map((x) => x.events.length).sort(), [1, 2]);
  assert.ok(g.find((x) => x.events.length === 2)!.events.some((e) => e.id === a.id), "the message with number 4471 joins the application with number 4471");
  assert.deepEqual(sizes(groupEventsV2([ev("applied", 0, { gmailThreadId: "A", signals: ["req:4471"] }), ev("applied", 0.2, { gmailThreadId: "A", signals: ["req:5120"] })])), [2], "unchanged without the option");
});
