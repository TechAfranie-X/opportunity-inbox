import type { Prediction } from "./predictions.ts";
import type { ThreadAnchor } from "./extract.ts";
import type { ExtractedEvent, RecruitingEmail } from "./types.ts";

/**
 * The sync, as a small pure engine behind injected dependencies (no Gmail, no database), so every rule is testable.
 *
 *  - Incremental: a message already evaluated by the current extractor is not fetched again.
 *  - Thread-complete: work is chunked by THREAD, and a thread with any new message is fetched whole, because the extractor
 *    links keyword-free replies to a thread's earlier messages and needs them in the same call.
 *  - Resumable: events are saved per chunk, newest mail first, under a time budget. A sync that stops early leaves everything
 *    it did and reports `remaining`; the next one continues where it stopped.
 *  - Reply-aware: the user's own replies are metadata-only and anchored on stored events, so recently active threads are
 *    refreshed every sync. Without this, an answered recruiter message would keep showing as "reply to the recruiter".
 *  - Embargoed: mail at or after `embargoBefore` is dropped wherever it appears (see lib/gmail/embargo.ts).
 */
export type CandidateRef = { id: string; threadId: string };

export type MailSource = {
  /** Candidate message refs, newest first. */
  listCandidates(max: number): Promise<CandidateRef[]>;
  /** Full inbound messages. Bodies are transient: they live only inside the engine's call stack. */
  fetchEmails(ids: string[]): Promise<{ emails: RecruitingEmail[]; missing: string[] }>;
  /** The user's own messages in these threads, metadata only. */
  fetchOutbound(threadIds: string[]): Promise<RecruitingEmail[]>;
};

export type SyncStore = {
  evaluatedIds(ids: string[]): Promise<Set<string>>;
  saveEvents(events: ExtractedEvent[]): Promise<void>;
  savePredictions(predictions: Prediction[]): Promise<void>;
  prune(scannedIds: string[], keptIds: string[]): Promise<void>;
  /** One anchor per thread that has recruiting activity within `days`. */
  recentAnchors(days: number): Promise<ThreadAnchor[]>;
  /** Fill empty roles across ALL stored events with the extractor's own rule, so splitting a sync into chunks loses nothing. */
  inheritRoles(): Promise<void>;
  finish(scanned: number): Promise<{ events: number }>;
};

export type EngineParams = {
  maxCandidates: number;
  threadsPerChunk: number;
  budgetMs: number;
  recentDays: number;
  embargoBefore: Date | null;
  now?: () => number;
  extract: (emails: RecruitingEmail[]) => ExtractedEvent[];
  predict: (emails: RecruitingEmail[]) => Prediction[];
  outboundEvent: (email: RecruitingEmail, anchor: ThreadAnchor) => ExtractedEvent;
};

export type EngineResult = {
  /** Candidate messages found by the search. */
  scanned: number;
  /** Candidates skipped because the current extractor had already evaluated them. */
  reused: number;
  /** Messages fetched and evaluated in this run. */
  fetched: number;
  /** Unevaluated candidates not reached before the budget ended. Zero means the sync is complete. */
  remaining: number;
  /** Replies found by the refresh of recently active threads. */
  repliesFound: number;
  events: number;
};

export type Chunk = { ids: string[]; unknown: number };

/** Group refs by thread, keep threads that contain anything new, and cut them into chunks of whole threads, newest first. */
export function planChunks(refs: CandidateRef[], known: Set<string>, threadsPerChunk: number): { chunks: Chunk[]; unknown: number } {
  const threads = new Map<string, CandidateRef[]>();
  for (const r of refs) {
    const key = r.threadId || `solo:${r.id}`;
    const list = threads.get(key);
    if (list) list.push(r); else threads.set(key, [r]);
  }
  const dirty = [...threads.values()].filter((rs) => rs.some((r) => !known.has(r.id)));
  const chunks: Chunk[] = [];
  for (let i = 0; i < dirty.length; i += threadsPerChunk) {
    const group = dirty.slice(i, i + threadsPerChunk).flat();
    chunks.push({ ids: group.map((r) => r.id), unknown: group.filter((r) => !known.has(r.id)).length });
  }
  return { chunks, unknown: chunks.reduce((n, c) => n + c.unknown, 0) };
}

export async function runSync(source: MailSource, store: SyncStore, p: EngineParams): Promise<EngineResult> {
  const now = p.now ?? Date.now;
  const started = now();
  const allowed = (e: RecruitingEmail) => !p.embargoBefore || e.receivedAt.getTime() < p.embargoBefore.getTime();

  const refs = await source.listCandidates(p.maxCandidates);
  const known = await store.evaluatedIds(refs.map((r) => r.id));
  const plan = planChunks(refs, known, p.threadsPerChunk);

  let fetched = 0, handledUnknown = 0;
  const handledThreads = new Set<string>();
  for (const chunk of plan.chunks) {
    if (now() - started > p.budgetMs) break;
    const { emails } = await source.fetchEmails(chunk.ids);
    const inbound = emails.filter((e) => !e.outbound && allowed(e));
    const inboundEvents = p.extract(inbound);
    const threadIds = [...new Set(inboundEvents.map((e) => e.gmailThreadId))];
    const outbound = threadIds.length ? (await source.fetchOutbound(threadIds)).filter(allowed) : [];
    const events = p.extract([...inbound, ...outbound]);
    await store.saveEvents(events);
    try {
      await store.savePredictions(p.predict([...inbound, ...outbound]));
    } catch {
      // The prediction log is evaluation evidence and the "already evaluated" memory: losing it only costs a re-read next time.
    }
    await store.prune(inbound.map((e) => e.id), events.map((e) => e.gmailMessageId));
    for (const t of threadIds) handledThreads.add(t);
    fetched += chunk.ids.length;
    handledUnknown += chunk.unknown;
  }

  // Replies to recently active threads, which no new inbound message would otherwise reveal.
  let repliesFound = 0;
  const anchors = (await store.recentAnchors(p.recentDays)).filter((a) => !handledThreads.has(a.gmailThreadId));
  if (anchors.length > 0) {
    const byThread = new Map(anchors.map((a) => [a.gmailThreadId, a]));
    const replies = (await source.fetchOutbound([...byThread.keys()])).filter(allowed);
    const events = replies.flatMap((e) => (byThread.has(e.threadId) ? [p.outboundEvent(e, byThread.get(e.threadId)!)] : []));
    await store.saveEvents(events);
    repliesFound = events.length;
  }

  await store.inheritRoles();
  const { events } = await store.finish(refs.length);
  return { scanned: refs.length, reused: refs.length - plan.chunks.reduce((n, c) => n + c.ids.length, 0), fetched, remaining: plan.unknown - handledUnknown, repliesFound, events };
}
