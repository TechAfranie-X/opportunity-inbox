import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunities } from "../recruiting/opportunity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { detectContradictions } from "./contradictions.ts";
import { resolveEmployers } from "./employer-identity.ts";

// Fictional employers; the shapes are general failure patterns (a platform's name read as the employer; one employer spelled two ways; progress after a rejection).
let n = 0;
const base = Date.UTC(2026, 0, 1);
const ev = (o: { type: EventType; day: number; company: string | null; thread: string; signals?: string[]; role?: string | null; outbound?: boolean; corrected?: boolean; domain?: string; sender?: string }): EffectiveEvent => {
  const id = `e${++n}`;
  return { id, gmailMessageId: id, gmailThreadId: o.thread, occurredAt: new Date(base + o.day * 86_400_000), outbound: o.outbound ?? false, senderName: o.sender ?? "x", senderDomain: o.domain ?? "mailer.example", subject: "s", type: o.type, company: o.company, role: o.role ?? null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.5, role: 0.6 }, reviewReasons: [], signals: o.signals ?? [], corrected: o.corrected ?? false } as EffectiveEvent;
};
const names = (es: EffectiveEvent[]) => es.map((e) => e.company);

test("a name found only in the sender yields to the one employer the thread's own text names", () => {
  const out = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Harborline", thread: "t1" }),
    ev({ type: "interview_invite", day: 2, company: "Mailer", thread: "t1", signals: ["employer:sender-only"] }),
    ev({ type: "follow_up", day: 3, company: "Mailer", thread: "t2", signals: ["employer:sender-only"] }),
  ]);
  assert.deepEqual(names(out), ["Harborline", "Harborline", "Mailer"], "another thread has no such evidence and is left alone");
});

test("one sender that writes for exactly one employer lends that name to its sender-only mail, only when the sender's own label carries the name", () => {
  const out = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Fernbank Interactive Ltd", thread: "t1", sender: "Fernbank Games", domain: "workwell-ats.example" }),
    ev({ type: "assessment", day: 2, company: "Workwell-ats", thread: "t2", sender: "Fernbank Games", domain: "workwell-ats.example", signals: ["employer:sender-only"] }),
    ev({ type: "assessment", day: 3, company: "Workwell-ats", thread: "t3", sender: "Applicant Hub", domain: "workwell-ats.example", signals: ["employer:sender-only"] }),
  ]);
  assert.deepEqual(names(out), ["Fernbank Interactive Ltd", "Fernbank Interactive Ltd", "Workwell-ats"], "a platform's generic label proves nothing");
});

test("a thread that names two different employers does not overrule a sender-only name", () => {
  const out = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Harborline", thread: "t1" }),
    ev({ type: "applied", day: 1, company: "Quillon Labs", thread: "t1" }),
    ev({ type: "follow_up", day: 3, company: "Mailer", thread: "t1", signals: ["employer:sender-only"] }),
  ]);
  assert.equal(out[2].company, "Mailer");
});

test("two spellings of one employer unify only when a thread ties them, never on a prefix alone", () => {
  const tied = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Solstice Robotics", thread: "t1" }),
    ev({ type: "interview_invite", day: 2, company: "Solstice", thread: "t1" }),
  ]);
  assert.deepEqual(names(tied), ["Solstice Robotics", "Solstice Robotics"]);
  const apart = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Capital One", thread: "t1" }),
    ev({ type: "applied", day: 2, company: "Capital", thread: "t2" }),
  ]);
  assert.deepEqual(names(apart), ["Capital One", "Capital"], "a look-alike in another thread is a different employer until something ties them");
});

test("a short name that could extend to two different employers is left alone", () => {
  const out = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Nordmarkt Logistik", thread: "t1" }),
    ev({ type: "applied", day: 1, company: "Nordmarkt Digital", thread: "t2" }),
    ev({ type: "follow_up", day: 3, company: "Nordmarkt", thread: "t1" }),
    ev({ type: "follow_up", day: 4, company: "Nordmarkt", thread: "t2" }),
  ]);
  assert.deepEqual(names(out), ["Nordmarkt Logistik", "Nordmarkt Digital", "Nordmarkt", "Nordmarkt"]);
});

test("a person's own correction is never rewritten", () => {
  const out = resolveEmployers([
    ev({ type: "applied", day: 0, company: "Harborline", thread: "t1" }),
    ev({ type: "follow_up", day: 2, company: "Mailer", thread: "t1", signals: ["employer:sender-only"], corrected: true }),
  ]);
  assert.equal(out[1].company, "Mailer");
});

test("progress after a rejection in the same thread continues the process and is flagged; a new application starts a new opportunity", () => {
  const opps = buildOpportunities([
    ev({ type: "applied", day: 0, company: "Orbis", thread: "t1", role: "Data Intern" }),
    ev({ type: "rejection", day: 10, company: "Orbis", thread: "t1", role: "Data Intern" }),
    ev({ type: "interview_invite", day: 20, company: "Orbis", thread: "t1", role: "Data Intern" }),
  ]);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].contradictions?.[0]?.kind, "reopened");
  const fresh = buildOpportunities([
    ev({ type: "applied", day: 0, company: "Orbis", thread: "t1", role: "Data Intern" }),
    ev({ type: "rejection", day: 10, company: "Orbis", thread: "t1", role: "Data Intern" }),
    ev({ type: "applied", day: 20, company: "Orbis", thread: "t1", role: "Data Intern" }),
  ]);
  assert.equal(fresh.length, 2, "a second application after a rejection is a new opportunity");
});

test("contradictions: an offer then an ending is flagged; an ordinary rejection or a settled item is not", () => {
  const plain = [ev({ type: "applied", day: 0, company: "Orbis", thread: "t" }), ev({ type: "rejection", day: 5, company: "Orbis", thread: "t" })];
  assert.deepEqual(detectContradictions(plain), []);
  const rescinded = [ev({ type: "offer", day: 0, company: "Orbis", thread: "t" }), ev({ type: "rejection", day: 5, company: "Orbis", thread: "t" })];
  assert.equal(detectContradictions(rescinded)[0]?.kind, "offer_ended");
  const settled = [ev({ type: "rejection", day: 0, company: "Orbis", thread: "t" }), { ...ev({ type: "interview_scheduled", day: 3, company: "Orbis", thread: "t" }), confirmed: true }];
  assert.deepEqual(detectContradictions(settled), []);
});

test("an override made under the key the previous identity generation issued still reaches the opportunity (key continuity)", () => {
  const events = [
    ev({ type: "applied", day: 0, company: "Harborline", thread: "t1", role: "Data Intern" }),
    ev({ type: "interview_invite", day: 2, company: "Hirelane", thread: "t1", role: "Data Intern", signals: ["employer:sender-only"] }),
  ];
  const first = buildOpportunities(events);
  assert.equal(first.length, 1);
  const oldKey = "hirelane~c0~data"; // what the previous generation called the group holding the later message
  const withOverride = buildOpportunities(events, new Map([[oldKey, { status: "closed" as const }]]));
  assert.ok(first[0].legacyKeys?.includes(oldKey) || withOverride[0].status === "closed", `legacy keys: ${first[0].legacyKeys?.join(",")} / key ${first[0].key}`);
});

test("a retraction of an ending reopens the process and is flagged; an ordinary update after a rejection does not", () => {
  const retract = buildOpportunities([
    ev({ type: "applied", day: 0, company: "Orbis", thread: "t", role: "Data Intern" }),
    ev({ type: "rejection", day: 10, company: "Orbis", thread: "t", role: "Data Intern" }),
    ev({ type: "status_update", day: 12, company: "Orbis", thread: "t", role: "Data Intern", signals: ["retraction (fact)"] }),
  ]);
  assert.equal(retract.length, 1);
  assert.equal(retract[0].status, "active");
  assert.equal(retract[0].contradictions?.[0]?.kind, "reopened");
  const plain = buildOpportunities([
    ev({ type: "applied", day: 0, company: "Orbis", thread: "t", role: "Data Intern" }),
    ev({ type: "rejection", day: 10, company: "Orbis", thread: "t", role: "Data Intern" }),
    ev({ type: "status_update", day: 12, company: "Orbis", thread: "t", role: "Data Intern" }),
  ]);
  assert.equal(plain[0].status, "closed");
});

test("a scheduled interview that a later message cancelled is not an upcoming interview", async () => {
  const { buildActions } = await import("../recruiting/actions.ts");
  const day = 86_400_000;
  const soon = new Date(Date.UTC(2026, 10, 20));
  const mk = (type: EventType, d: number, extra: Partial<EffectiveEvent> = {}) => ev({ type, day: d, company: "Orbis", thread: "t", role: "Data Intern", ...extra });
  const sched = { ...mk("interview_scheduled", 0), eventDate: soon } as EffectiveEvent;
  const cancel = { ...mk("status_update", 1, { signals: ["cancellation (fact)", "cancelled:2026-11-20"] }) } as EffectiveEvent;
  const opps = buildOpportunities([sched, cancel]);
  const now = new Date(Date.UTC(2026, 10, 19, 12));
  void day;
  assert.equal(buildActions(opps, now).filter((a) => a.kind === "upcoming_interview").length, 0);
  const live = buildOpportunities([sched]);
  assert.equal(buildActions(live, now).filter((a) => a.kind === "upcoming_interview").length, 1);
});

test("two applications that once shared a key stay independently addressable: an old key never shadows another opportunity's current key", () => {
  const a = ev({ type: "applied", day: 0, company: "Orbis", thread: "ta" });
  const b = ev({ type: "applied", day: 3, company: "Orbis", thread: "tb" });
  const opps = buildOpportunities([a, b]);
  assert.equal(opps.length, 2);
  const keys = new Set(opps.map((o) => o.key));
  assert.equal(keys.size, 2);
  for (const o of opps) for (const k of o.legacyKeys ?? []) assert.ok(k === o.key || !keys.has(k), `legacy key ${k} of ${o.key} shadows a current key`);
});
