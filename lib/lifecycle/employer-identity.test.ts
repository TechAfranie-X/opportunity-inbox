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
