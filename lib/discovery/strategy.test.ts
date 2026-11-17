import assert from "node:assert/strict";
import test from "node:test";
import { CANDIDATE_QUERY_V2 } from "../recruiting/reader/triage.ts";
import { RECRUITING_QUERY } from "../gmail/queries.ts";
import { sampleMailSource } from "../gmail/sample-source.ts";
import { buildDemoMailbox } from "../recruiting/fixtures.ts";
import { sampleEmails } from "../recruiting/sample-mailbox.ts";
import { extractAll, inheritRoles, outboundEvent, type ThreadAnchor } from "../recruiting/extract.ts";
import { buildPredictions, type Prediction } from "../recruiting/predictions.ts";
import { runSync, type EngineParams, type MailSource, type SyncStore } from "../recruiting/sync-engine.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { LEGACY_QUERY_TERMS, matchesLegacyQuery } from "./legacy-query.ts";
import { SWEEP_QUERY, discoveryMode, mergeTiers, minimizeSweepPredictions, tagEvents } from "./strategy.ts";

const NOW = new Date("2026-11-10T12:00:00Z");

// ------------------------------------------------------------------ mode and query
test("discovery is keyword-only unless DISCOVERY is exactly 'sweep'", () => {
  assert.equal(discoveryMode({}), "keyword");
  assert.equal(discoveryMode({ DISCOVERY: "sweep" }), "sweep");
  for (const v of ["", "1", "true", "SWEEP", "keyword", "sweep "]) assert.equal(discoveryMode({ DISCOVERY: v }), "keyword", `"${v}"`);
});

test("the sweep query is semantic: it excludes Gmail's bulk categories and filters on no hiring vocabulary", () => {
  assert.equal(SWEEP_QUERY, CANDIDATE_QUERY_V2, "the same candidate query the frozen shadow work defined, so the two cannot drift");
  for (const c of ["promotions", "social", "forums"]) assert.ok(SWEEP_QUERY.includes(`-category:${c}`));
  for (const x of ["-in:spam", "-in:trash", "-in:sent", "-in:drafts"]) assert.ok(SWEEP_QUERY.includes(x));
  assert.doesNotMatch(SWEEP_QUERY, /subject:|from:|interview|application|offer|recruit|assessment/i);
});

// ------------------------------------------------------------------ the measurement model of the old search
test("the legacy-query model is derived from the real query string", () => {
  assert.ok(LEGACY_QUERY_TERMS.subject.includes("interview") && LEGACY_QUERY_TERMS.subject.includes("online assessment") && LEGACY_QUERY_TERMS.subject.includes("next steps"));
  assert.ok(LEGACY_QUERY_TERMS.from.includes("greenhouse.io") && LEGACY_QUERY_TERMS.from.includes("hackerrank.com"));
  assert.ok(RECRUITING_QUERY.includes("greenhouse.io"));
});

test("legacy-query model: whole words and phrases in the subject, substrings of the sender", () => {
  assert.equal(matchesLegacyQuery("a@b.com", "Your interview is confirmed"), true);
  assert.equal(matchesLegacyQuery("a@b.com", "Next steps with Acme"), true, "a phrase");
  assert.equal(matchesLegacyQuery("a@b.com", "Interviewing tips"), false, "whole words only");
  assert.equal(matchesLegacyQuery("a@b.com", "Quick question about Tuesday"), false, "a recruiter email with no keyword");
  assert.equal(matchesLegacyQuery("Acme <no-reply@us.greenhouse-mail.io>", "Hello"), true, "an applicant-tracking sender");
});

// ------------------------------------------------------------------ merging, provenance, minimisation
test("mergeTiers puts keyword hits first, de-duplicates, and labels each message with its tier", () => {
  const merged = mergeTiers([{ id: "k1", threadId: "T1" }, { id: "k2", threadId: "T2" }], [{ id: "s1", threadId: "T9" }, { id: "k1", threadId: "T1" }, { id: "s2", threadId: "T2" }]);
  assert.deepEqual(merged.map((r) => `${r.id}:${r.via}`), ["k1:keyword", "k2:keyword", "s1:sweep", "s2:sweep"]);
});

const event = (id: string): ExtractedEvent => ({ gmailMessageId: id, gmailThreadId: "t", occurredAt: NOW, outbound: false, senderName: "", senderDomain: "acme.com", subject: "s", type: "applied", company: "Acme", role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.8, signals: ["application confirmation", "subject"] });

test("provenance is a signal: untouched without tiers, labelled with them", () => {
  const events = [event("a"), event("b")];
  assert.equal(tagEvents(events, new Map()), events, "keyword mode stays byte-identical");
  const tagged = tagEvents(events, new Map([["a", "sweep" as const], ["b", "keyword" as const]]));
  assert.deepEqual(tagged.map((e) => e.signals.at(-1)), ["via:sweep", "via:keyword"]);
  assert.deepEqual(tagEvents(tagged, new Map([["a", "sweep" as const]]))[0].signals.filter((s) => s.startsWith("via:")), ["via:sweep"], "never duplicated");
});

const prediction = (id: string, decision: Prediction["decision"]): Prediction => ({ gmailMessageId: id, gmailThreadId: "t", extractorVersion: "v", decision, outbound: false, senderDomain: "bank.example", type: null, company: null, role: null, eventDate: null, dateKind: null, confidence: null, fieldConfidence: null, signals: decision === "not_recruiting" ? ["rejected:no_recruiting_language"] : ["x"], reviewReasons: [] });

test("a message the sweep read and the reader rejected is remembered by id alone: no sender domain", () => {
  const via = new Map([["sw-no", "sweep" as const], ["sw-yes", "sweep" as const], ["kw-no", "keyword" as const]]);
  const out = minimizeSweepPredictions([prediction("sw-no", "not_recruiting"), prediction("sw-yes", "recruiting"), prediction("kw-no", "not_recruiting"), prediction("untagged", "not_recruiting")], via);
  const by = new Map(out.map((p) => [p.gmailMessageId, p]));
  assert.equal(by.get("sw-no")!.senderDomain, "", "new retention avoided");
  assert.equal(by.get("sw-yes")!.senderDomain, "bank.example", "a recruiting decision keeps its fields, as before");
  assert.equal(by.get("kw-no")!.senderDomain, "bank.example", "the original keyword path is unchanged");
  assert.equal(by.get("untagged")!.senderDomain, "bank.example");
  assert.ok(by.get("sw-no")!.signals.includes("via:sweep") && by.get("sw-no")!.signals.includes("rejected:no_recruiting_language"));
  const same = [prediction("a", "not_recruiting")];
  assert.equal(minimizeSweepPredictions(same, new Map()), same);
});

// ------------------------------------------------------------------ the engine, end to end, both modes
function mailbox(mail: RecruitingEmail[], mode: "keyword" | "sweep", keywordMatches: (e: RecruitingEmail) => boolean) {
  const newest = (xs: RecruitingEmail[]) => xs.filter((e) => !e.outbound).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((e) => ({ id: e.id, threadId: e.threadId }));
  const fetched: string[] = [];
  const source: MailSource = {
    async listCandidates() {
      const keyword = newest(mail.filter(keywordMatches));
      return mode === "sweep" ? mergeTiers(keyword, newest(mail)) : keyword;
    },
    async fetchEmails(ids) { fetched.push(...ids); return { emails: mail.filter((e) => ids.includes(e.id)), missing: [] }; },
    async fetchOutbound(threadIds) { return mail.filter((e) => e.outbound && threadIds.includes(e.threadId)).map((e) => ({ ...e, bodyText: "" })); },
  };
  return { source, fetched };
}

function memoryStore() {
  const events = new Map<string, ExtractedEvent>();
  const predictions = new Map<string, Prediction>();
  const store: SyncStore = {
    async evaluatedIds(ids) { return new Set(ids.filter((id) => predictions.has(id))); },
    async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
    async savePredictions(ps) { for (const p of ps) predictions.set(p.gmailMessageId, p); },
    async prune() {},
    async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
    async inheritRoles() { inheritRoles([...events.values()]); },
    async finish() { return { events: events.size }; },
  };
  return { store, events, predictions };
}

const params = (over: Partial<EngineParams> = {}): EngineParams => ({ maxCandidates: 600, threadsPerChunk: 2, budgetMs: 1e9, recentDays: 30, embargoBefore: null, extract: extractAll, predict: buildPredictions, outboundEvent, ...over });
const keywordFree = (e: RecruitingEmail) => matchesLegacyQuery(e.from, e.subject);

// A recruiter writes with no hiring word in the subject; a bank and a friend write too (private, never recruiting).
const SECRET = "ZEBRA-4417-private-balance";
const planted: RecruitingEmail[] = [
  { id: "r1", threadId: "tr", from: "Priya Nair <priya.nair@acme.com>", subject: "Quick question about your background", receivedAt: new Date(NOW.getTime() - 3_600_000), outbound: false, bodyText: "Hi Sam, I'm a recruiter at Acme. I came across your application for the Backend Engineer Intern role and would love to set up a quick call." },
  { id: "b1", threadId: "tb", from: "Bank <alerts@bank.example>", subject: "Your statement is ready", receivedAt: new Date(NOW.getTime() - 7_200_000), outbound: false, bodyText: `Your balance note ${SECRET}. View your statement.` },
  { id: "f1", threadId: "tf", from: "Alex <alex@friends.example>", subject: "dinner friday?", receivedAt: new Date(NOW.getTime() - 9_000_000), outbound: false, bodyText: "are we still on for dinner" },
];

test("END TO END: keyword mode never finds the keyword-free recruiter; sweep mode does, labels it, and keeps nothing private", async () => {
  const kw = memoryStore();
  const kwBox = mailbox(planted, "keyword", keywordFree);
  await runSync(kwBox.source, kw.store, params());
  assert.equal(kw.events.size, 0, "the original behavior: invisible");
  assert.deepEqual(kwBox.fetched, [], "and nothing was even read");

  const sw = memoryStore();
  const swBox = mailbox(planted, "sweep", keywordFree);
  const r = await runSync(swBox.source, sw.store, params());
  assert.equal(r.remaining, 0);
  const found = sw.events.get("r1");
  assert.ok(found, "the recruiter email is now an event");
  assert.equal(found!.company?.toLowerCase(), "acme");
  assert.ok(found!.signals.includes("via:sweep"));
  assert.equal(sw.events.has("b1") || sw.events.has("f1"), false, "the reader still rejects private mail");

  for (const id of ["b1", "f1"]) {
    const p = sw.predictions.get(id)!;
    assert.equal(p.decision, "not_recruiting");
    assert.equal(p.senderDomain, "", "no sender domain retained for rejected sweep mail");
    assert.ok(p.signals.includes("via:sweep"));
  }
  const stored = JSON.stringify([...sw.events.values(), ...sw.predictions.values()]);
  for (const leak of [SECRET, "dinner", "friends.example", "bank.example", "statement"]) assert.ok(!stored.includes(leak), `leaked ${leak}`);
});

test("keyword mode output is byte-identical to the original: no provenance anywhere", async () => {
  const s = memoryStore();
  await runSync(mailbox(buildDemoMailbox(NOW).map((f) => f.email), "keyword", () => true).source, s.store, params());
  const all = JSON.stringify([...s.events.values(), ...s.predictions.values()]);
  assert.ok(!all.includes("via:"));
});

test("the sweep never delays what the product always found: keyword hits are read first under a tight budget", async () => {
  const mail: RecruitingEmail[] = [
    ...Array.from({ length: 6 }, (_, i): RecruitingEmail => ({ id: `s${i}`, threadId: `ts${i}`, from: "Alex <alex@friends.example>", subject: `note ${i}`, receivedAt: new Date(NOW.getTime() - i * 1000), outbound: false, bodyText: "hello" })),
    { id: "k1", threadId: "tk", from: "Acme <jobs@acme.com>", subject: "Your interview is confirmed", receivedAt: new Date(NOW.getTime() - 86_400_000 * 30), outbound: false, bodyText: "Your interview for the Backend Intern role is confirmed for November 20, 2026 at 2:00 PM." },
  ];
  const box = mailbox(mail, "sweep", keywordFree);
  let calls = 0;
  const s = memoryStore();
  // the clock reads 0 for the start and the first chunk's check, then jumps past the budget: exactly one chunk fits
  const r = await runSync(box.source, s.store, params({ threadsPerChunk: 1, budgetMs: 10, now: () => (calls++ < 2 ? 0 : 1000) }));
  assert.ok(r.remaining > 0, "the budget ended before the whole sweep");
  assert.equal(box.fetched[0], "k1", "even though it is the oldest message, the keyword hit was read first");
  assert.ok(s.events.has("k1"));
  const r2 = await runSync(box.source, s.store, params());
  assert.equal(r2.remaining, 0, "and the next sync resumes and finishes");
});

test("a second sweep sync reads nothing it has already read", async () => {
  const s = memoryStore();
  const box = mailbox(planted, "sweep", keywordFree);
  await runSync(box.source, s.store, params());
  box.fetched.length = 0;
  const r = await runSync(box.source, s.store, params());
  assert.deepEqual(box.fetched, []);
  assert.equal(r.reused, r.scanned);
});

// ------------------------------------------------------------------ the sample mailbox
test("sample mailbox: the sweep reaches the planted keyword-free recruiter email and not the promotions", async () => {
  const anchor = new Date("2026-11-10T15:00:00Z");
  const all = sampleEmails(anchor);
  const byId = new Map(all.map((e) => [e.id, e]));
  const keyword = await sampleMailSource(anchor, "keyword").listCandidates(1000);
  const sweep = await sampleMailSource(anchor, "sweep").listCandidates(1000);
  const keywordIds = new Set(keyword.map((r) => r.id));
  assert.deepEqual(sweep.slice(0, keyword.length).map((r) => r.id), keyword.map((r) => r.id), "keyword hits first, in the same order");
  const extra = sweep.slice(keyword.length).map((r) => byId.get(r.id)!);
  assert.ok(extra.length > 0 && extra.every((e) => !keywordIds.has(e.id) && !e.outbound));
  assert.ok(extra.some((e) => /quick chat/i.test(e.subject)), "the Datadog recruiter email");
  assert.ok(extra.every((e) => !/nike|dailydev|handshake|linkedin|coursera|amazon/i.test(e.from)), "promotions stay out, as -category:promotions does");
  assert.ok(sweep.every((r) => r.via), "every candidate is labelled");
});
