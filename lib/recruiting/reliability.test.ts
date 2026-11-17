import assert from "node:assert/strict";
import test from "node:test";
import { contactKeysOf, isContactKey } from "../discovery/continuity.ts";
import { contactKeyOf, extractAll, inheritRoles, isContinuityCandidate, outboundEvent, type ThreadAnchor } from "./extract.ts";
import { buildPredictions, type Prediction } from "./predictions.ts";
import { PRODUCT_READER_VERSION } from "./product-version.ts";
import { runSync, type CandidateRef, type EngineParams, type MailSource, type SyncStore } from "./sync-engine.ts";
import { syncNotice } from "./sync-notice.ts";
import { EXTRACTOR_VERSION } from "./version.ts";
import { FROZEN } from "./shadow/frozen.ts";
import type { ExtractedEvent, RecruitingEmail } from "./types.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const mail = (id: string, thread: string, from: string, subject: string, body: string, hoursAgo: number): RecruitingEmail => ({ id, threadId: thread, from, subject, receivedAt: at(hoursAgo), outbound: false, bodyText: body });

/** Source over an array, with switches for the failure modes. */
function source(all: RecruitingEmail[], opts: { failIds?: Set<string>; failedThreads?: number; truncated?: boolean } = {}) {
  const fetched: string[] = [];
  const s: MailSource = {
    async listCandidates() {
      const refs: CandidateRef[] = all.filter((e) => !e.outbound).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((e) => ({ id: e.id, threadId: e.threadId }));
      return opts.truncated === undefined ? refs : { refs, truncated: opts.truncated };
    },
    async fetchEmails(ids) {
      fetched.push(...ids);
      const failed = ids.filter((id) => opts.failIds?.has(id));
      return { emails: all.filter((e) => ids.includes(e.id) && !failed.includes(e.id)), missing: failed, failed };
    },
    async fetchOutbound(threadIds) {
      const emails = all.filter((e) => e.outbound && threadIds.includes(e.threadId)).map((e) => ({ ...e, bodyText: "" }));
      return opts.failedThreads ? { emails, failedThreads: opts.failedThreads } : emails;
    },
  };
  return { source: s, fetched };
}

function memoryStore(withContacts = true) {
  const events = new Map<string, ExtractedEvent>();
  const predictions = new Map<string, Prediction>();
  const store: SyncStore = {
    async evaluatedIds(ids) { return new Set(ids.filter((id) => predictions.has(id))); },
    async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
    async savePredictions(ps) { for (const p of ps) if (!predictions.has(p.gmailMessageId)) predictions.set(p.gmailMessageId, p); },
    async prune() {},
    async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
    async inheritRoles() { inheritRoles([...events.values()]); },
    async finish() { return { events: events.size }; },
    ...(withContacts ? { async contactAnchors(keys: string[]) {
      const m = new Map<string, ThreadAnchor>();
      for (const e of events.values()) for (const k of keys) if (!e.outbound && e.signals.includes(k) && (!m.has(k) || (!m.get(k)!.company && e.company))) m.set(k, { gmailThreadId: e.gmailThreadId, company: e.company, role: e.role, confidence: e.confidence, fieldConfidence: e.fieldConfidence });
      return m;
    } } : {}),
  };
  return { store, events, predictions };
}

const params = (over: Partial<EngineParams> = {}): EngineParams => ({ maxCandidates: 600, threadsPerChunk: 1, budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract: extractAll, deferable: isContinuityCandidate, predict: (e) => buildPredictions(e), outboundEvent, ...over });

const APPLIED = mail("a1", "t1", "Acme Careers <jobs@us.greenhouse-mail.io>", "Thank you for applying to Acme", "Hi Sam, thank you for applying to the Backend Engineer Intern position at Acme. We received your application.", 200);
const SCREEN = mail("s1", "t2", "Priya Nair <priya.nair@acme.com>", "Quick question about your background", "Hi Sam, I'm a recruiter at Acme. I came across your application for the Backend Engineer Intern role and would love to set up a quick call.", 100);
const REPLY = mail("r1", "t3", "Priya Nair <priya.nair@acme.com>", "Tuesday works", "Great, Tuesday at 3 works on my side. Talk then.", 10);

// ------------------------------------------------------------------ observable failures
test("a message that cannot be read is reported, not dropped: it is not remembered as evaluated and the next sync retries it", async () => {
  const m = memoryStore();
  const box = source([APPLIED, SCREEN, REPLY], { failIds: new Set(["s1"]) });
  const r = await runSync(box.source, m.store, params());
  assert.equal(r.failed, 1);
  assert.equal(m.predictions.has("s1"), false, "not remembered as read");
  assert.equal(m.predictions.has("a1"), true);
  assert.match(syncNotice(r) ?? "", /1 email could not be read/);

  const healthy = source([APPLIED, SCREEN, REPLY]);
  const r2 = await runSync(healthy.source, m.store, params());
  assert.deepEqual(healthy.fetched.filter((id) => id === "s1"), ["s1"], "retried");
  assert.equal(r2.failed, 0);
  assert.equal(syncNotice(r2), undefined, "and the notice goes away");
  assert.ok(m.events.has("s1"));
});

test("a reply check that failed is reported, because a stale 'reply to the recruiter' reminder would otherwise look certain", async () => {
  const m = memoryStore();
  const r = await runSync(source([APPLIED, SCREEN], { failedThreads: 2 }).source, m.store, params());
  assert.equal(r.repliesUnchecked >= 2, true);
  assert.match(syncNotice(r) ?? "", /replies could not be checked/);
});

test("hitting the candidate cap is reported instead of silently truncating the mailbox", async () => {
  const many = Array.from({ length: 5 }, (_, i) => mail(`m${i}`, `th${i}`, "Alex <alex@friends.example>", `note ${i}`, "hello", i + 1));
  const capped = await runSync(source(many).source, memoryStore().store, params({ maxCandidates: 5 }));
  assert.equal(capped.truncated, true, "a list exactly as long as the cap is presumed cut");
  assert.match(syncNotice(capped) ?? "", /oldest mail was not looked at/);
  const roomy = await runSync(source(many).source, memoryStore().store, params({ maxCandidates: 50 }));
  assert.equal(roomy.truncated, false);
  const flagged = await runSync(source(many, { truncated: true }).source, memoryStore().store, params({ maxCandidates: 50 }));
  assert.equal(flagged.truncated, true, "a source can say so itself");
});

test("syncNotice stays quiet when nothing went wrong and says nothing about content", () => {
  assert.equal(syncNotice({ failed: 0, repliesUnchecked: 0, truncated: false, remaining: 0 }), undefined);
  assert.equal(syncNotice({ failed: 0, repliesUnchecked: 0, truncated: true, remaining: 12 }), undefined, "still reading: not final yet");
});

// ------------------------------------------------------------------ continuity across chunk and sync boundaries
test("the contact key is a pseudonym: stable, case-insensitive, and never contains the address", () => {
  const k = contactKeyOf("Priya.Nair@Acme.com");
  assert.equal(k, contactKeyOf("priya.nair@acme.com"));
  assert.ok(isContactKey(k));
  assert.ok(!k.toLowerCase().includes("priya") && !k.includes("acme"));
  assert.notEqual(k, contactKeyOf("someone.else@acme.com"));
  for (const bad of ["contact:'; drop table recruiting_events; --", "contact:ABC", "x:" + k.slice(8), ""]) assert.equal(isContactKey(bad), false);
  assert.deepEqual(contactKeysOf([SCREEN, REPLY, { ...REPLY, outbound: true }]), [k], "one key per sender; the user's own messages add none");
});

test("a keyword-free reply is linked to its sender's earlier candidacy mail whatever the chunking, even though the sync reads newest first", async () => {
  const mailbox = [APPLIED, SCREEN, REPLY];
  const baseline = extractAll(mailbox).map((e) => `${e.gmailMessageId}|${e.type}|${e.company}`).sort();
  assert.ok(baseline.some((x) => x.startsWith("r1|status_update")), "one batch links the reply");
  for (const chunk of [1, 2, 3, 100]) {
    const m = memoryStore();
    await runSync(source(mailbox).source, m.store, params({ threadsPerChunk: chunk }));
    assert.deepEqual([...m.events.values()].map((e) => `${e.gmailMessageId}|${e.type}|${e.company}`).sort(), baseline, `chunk size ${chunk}`);
  }
  // without the context and the deferred pass, the reply (newer than its anchor, read first) is lost: this is the bug being fixed
  const without = memoryStore(false);
  await runSync(source(mailbox).source, without.store, params({ threadsPerChunk: 1, deferable: undefined }));
  assert.equal(without.events.has("r1"), false);
});

test("a reply that arrives in a LATER sync is linked through the stored anchor", async () => {
  const m = memoryStore();
  await runSync(source([APPLIED, SCREEN]).source, m.store, params());
  assert.equal(m.events.has("r1"), false);
  await runSync(source([APPLIED, SCREEN, REPLY]).source, m.store, params());
  const reply = m.events.get("r1");
  assert.ok(reply, "linked across the sync boundary");
  assert.equal(reply!.company?.toLowerCase(), "acme");
  assert.ok(reply!.signals.includes("known-contact-continuity"));
});

test("the prediction log agrees with the events, row for row, including linked messages", async () => {
  const m = memoryStore();
  await runSync(source([APPLIED, SCREEN, REPLY]).source, m.store, params());
  for (const id of ["a1", "s1", "r1"]) {
    const p = m.predictions.get(id)!;
    assert.equal(p.decision === "recruiting", m.events.has(id), id);
  }
  assert.equal(m.predictions.get("r1")!.company?.toLowerCase(), "acme");
});

test("no sender address is stored anywhere: events and predictions hold only the pseudonym", async () => {
  const m = memoryStore();
  await runSync(source([APPLIED, SCREEN, REPLY]).source, m.store, params());
  const stored = JSON.stringify([...m.events.values(), ...m.predictions.values()]);
  assert.ok(!/priya\.nair@|@acme\.com/i.test(stored));
  assert.ok(stored.includes("contact:"));
});

test("role mailboxes and consumer senders never anchor continuity", () => {
  assert.equal(isContinuityCandidate(mail("x", "t", "Acme Careers <careers@acme.com>", "s", "b", 1)), false);
  assert.equal(isContinuityCandidate(mail("x", "t", "Alex <alex@gmail.com>", "s", "b", 1)), false);
  assert.equal(isContinuityCandidate(SCREEN), true);
});

// ------------------------------------------------------------------ revisiting old decisions
test("the product reader version is its own key and never moves the frozen evaluation candidate's version", () => {
  assert.notEqual(PRODUCT_READER_VERSION, EXTRACTOR_VERSION);
  assert.ok(PRODUCT_READER_VERSION.startsWith(EXTRACTOR_VERSION));
  assert.equal(FROZEN.extractorVersion, EXTRACTOR_VERSION, "the frozen candidate still names the version it was frozen with");
});
