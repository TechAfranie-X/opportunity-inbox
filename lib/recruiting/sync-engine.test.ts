import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoMailbox } from "./fixtures.ts";
import { extractAll, inheritRoles, outboundEvent, type ThreadAnchor } from "./extract.ts";
import { buildPredictions, type Prediction } from "./predictions.ts";
import { planChunks, runSync, type CandidateRef, type EngineParams, type MailSource, type SyncStore } from "./sync-engine.ts";
import type { ExtractedEvent, RecruitingEmail } from "./types.ts";

const NOW = new Date("2026-11-10T12:00:00Z");

/** A fake mailbox holding RecruitingEmail objects. Search = inbound mail, newest first; replies are metadata only. */
function fakeMailbox(initial: RecruitingEmail[]) {
  const mail = [...initial];
  const calls = { list: 0, fetched: [] as string[], outboundThreads: [] as string[][] };
  const source: MailSource = {
    async listCandidates(max) { calls.list += 1; return mail.filter((e) => !e.outbound).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0, max).map((e): CandidateRef => ({ id: e.id, threadId: e.threadId })); },
    async fetchEmails(ids) { calls.fetched.push(...ids); return { emails: mail.filter((e) => ids.includes(e.id)), missing: ids.filter((id) => !mail.some((e) => e.id === id)) }; },
    async fetchOutbound(threadIds) { calls.outboundThreads.push(threadIds); return mail.filter((e) => e.outbound && threadIds.includes(e.threadId)).map((e) => ({ ...e, bodyText: "" })); },
  };
  return { mail, calls, source };
}

function fakeStore(opts: { failPredictions?: boolean } = {}) {
  const events = new Map<string, ExtractedEvent>();
  const predicted = new Set<string>();
  const state = { finished: 0, pruned: [] as string[] };
  const store: SyncStore = {
    async evaluatedIds(ids) { return new Set(ids.filter((id) => predicted.has(id))); },
    async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
    async savePredictions(ps: Prediction[]) { if (opts.failPredictions) throw new Error("log down"); for (const p of ps) predicted.add(p.gmailMessageId); },
    async prune(scanned, kept) { for (const id of scanned) if (!kept.includes(id) && events.delete(id)) state.pruned.push(id); },
    async recentAnchors(days) {
      const cutoff = NOW.getTime() - days * 86_400_000;
      const threads = new Set([...events.values()].filter((e) => e.occurredAt.getTime() >= cutoff).map((e) => e.gmailThreadId));
      const out = new Map<string, ThreadAnchor>();
      for (const e of [...events.values()].filter((x) => !x.outbound && threads.has(x.gmailThreadId)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
        const cur = out.get(e.gmailThreadId);
        if (!cur || (!cur.company && e.company)) out.set(e.gmailThreadId, { gmailThreadId: e.gmailThreadId, company: e.company, role: e.role, confidence: e.confidence, fieldConfidence: e.fieldConfidence });
      }
      return [...out.values()];
    },
    async inheritRoles() { inheritRoles([...events.values()]); },
    async finish() { state.finished += 1; return { events: events.size }; },
  };
  return { store, events, predicted, state };
}

const params = (over: Partial<EngineParams> = {}): EngineParams => ({
  maxCandidates: 600, threadsPerChunk: 3, budgetMs: 1e9, recentDays: 30, embargoBefore: null,
  extract: extractAll, predict: buildPredictions, outboundEvent, ...over,
});

const oneShot = (mail: RecruitingEmail[]) => extractAll([...mail.filter((e) => !e.outbound), ...mail.filter((e) => e.outbound).map((e) => ({ ...e, bodyText: "" }))]);
const view = (es: ExtractedEvent[]) => es.map((e) => `${e.gmailMessageId}|${e.type}|${e.company}|${e.role}|${e.outbound}|${e.gmailThreadId}`).sort();
const demo = () => buildDemoMailbox(NOW).map((f) => f.email);

test("planChunks keeps threads whole, newest first, and counts what is new", () => {
  const refs: CandidateRef[] = [
    { id: "a1", threadId: "A" }, { id: "b1", threadId: "B" }, { id: "a2", threadId: "A" }, { id: "c1", threadId: "C" }, { id: "d1", threadId: "D" }, { id: "s1", threadId: "" },
  ];
  const { chunks, unknown } = planChunks(refs, new Set(["a1", "b1", "d1"]), 2);
  assert.equal(unknown, 3, "a2, c1 and s1 are new");
  assert.deepEqual(chunks[0].ids, ["a1", "a2", "c1"], "thread A is fetched whole because a2 is new; thread B is entirely known and skipped");
  assert.deepEqual(chunks[1].ids, ["s1"], "a message with no thread id stands alone");
  assert.equal(chunks[0].unknown + chunks[1].unknown, 3);
});

test("planChunks: nothing new means nothing to fetch", () => {
  const { chunks, unknown } = planChunks([{ id: "a", threadId: "A" }], new Set(["a"]), 5);
  assert.deepEqual({ n: chunks.length, unknown }, { n: 0, unknown: 0 });
});

test("a full incremental sync produces exactly the events a one-shot extraction would", async () => {
  const box = fakeMailbox(demo()), s = fakeStore();
  const r = await runSync(box.source, s.store, params());
  assert.equal(r.remaining, 0);
  assert.deepEqual(view([...s.events.values()]), view(oneShot(box.mail)));
  assert.ok(r.events > 10, "the demo mailbox has real content");
});

test("a second sync with nothing new fetches nothing", async () => {
  const box = fakeMailbox(demo()), s = fakeStore();
  await runSync(box.source, s.store, params());
  box.calls.fetched.length = 0;
  const r = await runSync(box.source, s.store, params());
  assert.equal(r.fetched, 0);
  assert.equal(r.reused, r.scanned);
  assert.deepEqual(box.calls.fetched, []);
});

test("new mail in an old thread re-reads that whole thread (its context) and nothing else, and still equals one-shot", async () => {
  const mail = demo();
  const box = fakeMailbox(mail), s = fakeStore();
  await runSync(box.source, s.store, params());
  const thread = mail.find((e) => !e.outbound && /stripe/i.test(e.from + e.subject))!.threadId;
  const siblings = mail.filter((e) => !e.outbound && e.threadId === thread).map((e) => e.id);
  box.mail.push({ id: "late-1", threadId: thread, from: "Stripe Recruiting <no-reply@us.greenhouse-mail.io>", subject: "Stripe: next steps for your application", receivedAt: new Date(NOW.getTime() - 3_600_000), outbound: false, bodyText: "Thank you for completing the assessment. We would like to schedule an interview for the Software Engineer Intern role." });
  box.calls.fetched.length = 0;
  const r = await runSync(box.source, s.store, params());
  assert.deepEqual([...box.calls.fetched].sort(), [...siblings, "late-1"].sort());
  assert.equal(r.remaining, 0);
  assert.deepEqual(view([...s.events.values()]), view(oneShot(box.mail)));
});

test("REPLIES: a reply in an already-evaluated thread is found by the refresh, with the thread's company and role", async () => {
  const mail = demo();
  const box = fakeMailbox(mail), s = fakeStore();
  await runSync(box.source, s.store, params());
  const inbound = mail.filter((e) => !e.outbound && e.threadId === "t-dd-int")[0]; // active within the refresh window
  const reply: RecruitingEmail = { id: "reply-new", threadId: inbound.threadId, from: "Sam <sam@example.com>", subject: "Re: Next steps", receivedAt: new Date(NOW.getTime() - 60_000), outbound: true, bodyText: "" };
  box.mail.push(reply);
  assert.equal(s.events.has("reply-new"), false);
  const r = await runSync(box.source, s.store, params());
  const found = s.events.get("reply-new");
  assert.ok(found, "the reply is recorded although no new inbound mail arrived");
  assert.equal(found!.outbound, true);
  assert.equal(found!.type, "user_reply");
  assert.equal(found!.company, s.events.get(inbound.id)!.company);
  assert.equal(r.repliesFound >= 1, true);
  assert.equal(r.fetched, 0, "and no message body was fetched to learn it");
});

test("REPLIES: the refresh covers recently active threads only; a reply to a long-quiet thread waits for the next full evaluation", async () => {
  const mail = demo();
  const box = fakeMailbox(mail), s = fakeStore();
  await runSync(box.source, s.store, params());
  const quiet = mail.find((e) => !e.outbound && e.threadId === "t-stripe")!; // last activity is more than 30 days old in the demo mailbox
  box.mail.push({ id: "old-thread-reply", threadId: quiet.threadId, from: "Sam <sam@example.com>", subject: "Re: hello", receivedAt: new Date(NOW.getTime() - 60_000), outbound: true, bodyText: "" });
  await runSync(box.source, s.store, params());
  assert.equal(s.events.has("old-thread-reply"), false, "documented limitation (docs/mvp.md)");
  await runSync(box.source, s.store, params({ recentDays: 365 }));
  assert.equal(s.events.has("old-thread-reply"), true, "a wider window finds it");
});

test("BUDGET: a sync that runs out of time saves what it did, reports what is left, and the next one finishes identically", async () => {
  const box = fakeMailbox(demo()), s = fakeStore();
  let t = 0;
  const first = await runSync(box.source, s.store, params({ threadsPerChunk: 2, budgetMs: 10, now: () => (t += 8) }));
  assert.ok(first.remaining > 0 && first.fetched > 0, "partial progress");
  assert.ok(s.events.size > 0, "events from finished chunks are already saved");
  const second = await runSync(box.source, s.store, params({ threadsPerChunk: 2 }));
  assert.equal(second.remaining, 0);
  assert.deepEqual(view([...s.events.values()]), view(oneShot(box.mail)));
});

test("newest mail is read first, so an early stop leaves the oldest mail unread, not the newest", async () => {
  const box = fakeMailbox(demo()), s = fakeStore();
  let t = 0;
  await runSync(box.source, s.store, params({ threadsPerChunk: 1, budgetMs: 10, now: () => (t += 8) }));
  const inbound = box.mail.filter((e) => !e.outbound).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  const firstFetched = box.calls.fetched[0];
  assert.equal(firstFetched, inbound[0].id);
});

test("EMBARGO: mail at or after the cutoff is dropped everywhere, including replies", async () => {
  const cutoff = new Date(NOW.getTime() - 2 * 86_400_000);
  const mail = demo();
  const box = fakeMailbox(mail), s = fakeStore();
  await runSync(box.source, s.store, params({ embargoBefore: cutoff }));
  for (const e of s.events.values()) assert.ok(e.occurredAt.getTime() < cutoff.getTime(), `${e.gmailMessageId} is after the cutoff`);
  const eligible = mail.filter((e) => e.receivedAt.getTime() < cutoff.getTime());
  assert.deepEqual(view([...s.events.values()]), view(oneShot(eligible)));
  // a reply after the cutoff, in a thread that qualifies, is dropped as well
  const inbound = mail.find((e) => !e.outbound && e.receivedAt.getTime() < cutoff.getTime())!;
  box.mail.push({ id: "post-cutoff-reply", threadId: inbound.threadId, from: "Sam <s@x.example>", subject: "Re: hi", receivedAt: new Date(cutoff.getTime() + 1000), outbound: true, bodyText: "" });
  await runSync(box.source, s.store, params({ embargoBefore: cutoff }));
  assert.equal(s.events.has("post-cutoff-reply"), false);
});

test("a failing prediction log is not fatal: the sync completes and the messages are simply read again next time", async () => {
  const box = fakeMailbox(demo()), s = fakeStore({ failPredictions: true });
  const r = await runSync(box.source, s.store, params());
  assert.equal(r.remaining, 0);
  assert.ok(s.events.size > 0);
  box.calls.fetched.length = 0;
  await runSync(box.source, s.store, params());
  assert.ok(box.calls.fetched.length > 0, "nothing was remembered as evaluated, so it re-reads (correct, just slower)");
});

test("messages that cannot be fetched are skipped without breaking the sync", async () => {
  const box = fakeMailbox(demo()), s = fakeStore();
  const real = box.source.fetchEmails;
  box.source.fetchEmails = async (ids) => { const r = await real(ids); return { emails: r.emails.slice(1), missing: [r.emails[0]?.id ?? ""] }; };
  const r = await runSync(box.source, s.store, params());
  assert.equal(r.scanned > 0, true);
  assert.ok(s.events.size > 0);
});

test("no candidates at all is a clean empty sync", async () => {
  const box = fakeMailbox([]), s = fakeStore();
  const r = await runSync(box.source, s.store, params());
  assert.deepEqual({ scanned: r.scanned, fetched: r.fetched, remaining: r.remaining, events: r.events }, { scanned: 0, fetched: 0, remaining: 0, events: 0 });
  assert.equal(s.state.finished, 1);
});
