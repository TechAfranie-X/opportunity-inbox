import type { Prediction } from "./predictions.ts";
import type { ReadContext, ThreadAnchor } from "./extract.ts";
import { contactKeysOf, reconcilePredictions } from "../discovery/continuity.ts";
import { isNearMiss } from "../reliability/flags.ts";
import { buildChunkLedgers, type LedgerEntry } from "../ledger/chunk.ts";
import { applyAssist } from "../semantic/assist.ts";
import { applyConsensus } from "../semantic/consensus.ts";
import { reconcileReadings } from "../semantic/employer.ts";
import type { VerifiedReading } from "../semantic/reading.ts";
import type { SemanticReader } from "../semantic/port.ts";
import { semanticInputs } from "../semantic/inputs.ts";
import { minimizeSweepPredictions, tagEvents, viaMap } from "../discovery/strategy.ts";
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
/** `via` records which discovery tier found the message (see lib/discovery/strategy.ts); absent in the original keyword-only mode. */
export type CandidateRef = { id: string; threadId: string; via?: "keyword" | "sweep" };

/** A source may say the list hit its cap, so the engine can report that older mail was not looked at instead of staying silent. */
export type CandidateList = CandidateRef[] | { refs: CandidateRef[]; truncated?: boolean };
export type OutboundResult = RecruitingEmail[] | { emails: RecruitingEmail[]; failedThreads?: number };

export type MailSource = {
  /** Candidate message refs, newest first. */
  listCandidates(max: number): Promise<CandidateList>;
  /**
   * Full inbound messages. Bodies are transient: they live only inside the engine's call stack.
   * `missing` are messages that no longer exist; `failed` are messages that exist but could not be read this time (they are
   * not remembered as evaluated, so the next sync tries them again, and the result reports them).
   */
  fetchEmails(ids: string[]): Promise<{ emails: RecruitingEmail[]; missing: string[]; failed?: string[] }>;
  /** The user's own messages in these threads, metadata only. `failedThreads` counts threads whose replies could not be checked. */
  fetchOutbound(threadIds: string[]): Promise<OutboundResult>;
};

export type SyncStore = {
  evaluatedIds(ids: string[]): Promise<Set<string>>;
  saveEvents(events: ExtractedEvent[]): Promise<void>;
  savePredictions(predictions: Prediction[]): Promise<void>;
  /** Shadow-mode evidence ledger (lib/ledger). Optional; nothing reads it back into a product decision. */
  saveLedgers?(entries: LedgerEntry[]): Promise<void>;
  prune(scannedIds: string[], keptIds: string[]): Promise<void>;
  /** Earlier anchors for these contact keys (hashed sender addresses), so continuity survives chunk and sync boundaries. Optional. */
  contactAnchors?(keys: string[]): Promise<Map<string, ThreadAnchor>>;
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
  extract: (emails: RecruitingEmail[], context?: ReadContext) => ExtractedEvent[];
  /**
   * Messages for which "no event" is provisional: they are held until the run's chunks are all read and judged again with the anchors
   * those chunks produced. Their prediction rows are written only after that final judgement, so the log never disagrees with the events.
   */
  deferable?: (email: RecruitingEmail) => boolean;
  /**
   * An optional second, semantic reader (lib/semantic/port.ts). Off unless supplied. It sees only redacted, truncated inputs for messages that
   * pass the veto-only triage, and can only change what a person is asked, never a structured value.
   */
  semantic?: SemanticReader;
  /** "review" (default): the second reader only changes what a person is asked. "assist": its verified opinion may also create or exclude events (lib/semantic/assist.ts). */
  semanticMode?: "review" | "assist";
  /**
   * Employer resolution (lib/identity): normalizes names through the identity graph, rules out vendors, agencies and generic words, and writes a
   * calibrated known / likely / review / unknown company state. Pure and local; it runs after the readers, so it sees the rules' reading and, when
   * a second reader ran, its verified relationship evidence. Off unless supplied.
   */
  identity?: (events: ExtractedEvent[], emails: Map<string, RecruitingEmail>, readings: Map<string, VerifiedReading>) => ExtractedEvent[];
  /** Record the evidence ledger and the shadow engine's verdict for each message read (EVIDENCE_LEDGER=shadow). Off by default; it never changes a decision and a failure here loses only the record. */
  ledger?: boolean;
  /** Name tokens of the account holder, removed from what the second reader sees. */
  selfNames?: string[];
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
  /** Messages that exist but could not be read this time. They are retried by the next sync. Never silent: callers surface this. */
  failed: number;
  /** Threads whose replies could not be checked, so a "reply to the recruiter" reminder may be out of date. */
  repliesUnchecked: number;
  /** The candidate list hit its cap: older mail was not looked at. */
  truncated: boolean;
};

/** Bound on messages held in memory (with their bodies) for the deferred pass. */
const DEFER_MAX = 1500;

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

  const listed = await source.listCandidates(p.maxCandidates);
  const refs = Array.isArray(listed) ? listed : listed.refs;
  const truncated = Array.isArray(listed) ? refs.length >= p.maxCandidates : (listed.truncated ?? false);
  const via = viaMap(refs);
  const failedIds = new Set<string>();
  const deferred = new Map<string, RecruitingEmail>();
  const opinionLog = new Map<string, import("../recruiting/reader/types.ts").VerifiedOutput>();
  const readingLog = new Map<string, import("../semantic/reading.ts").VerifiedReading>();
  let repliesUnchecked = 0;
  const outboundOf = async (threadIds: string[]) => {
    const r = await source.fetchOutbound(threadIds);
    if (Array.isArray(r)) return r;
    repliesUnchecked += r.failedThreads ?? 0;
    return r.emails;
  };
  const known = await store.evaluatedIds(refs.map((r) => r.id));
  const plan = planChunks(refs, known, p.threadsPerChunk);

  let fetched = 0, handledUnknown = 0;
  const handledThreads = new Set<string>();
  for (const chunk of plan.chunks) {
    if (now() - started > p.budgetMs) break;
    const { emails, failed } = await source.fetchEmails(chunk.ids);
    for (const id of failed ?? []) failedIds.add(id);
    const inbound = emails.filter((e) => !e.outbound && allowed(e));
    const keys = contactKeysOf(inbound);
    const context: ReadContext = { contacts: keys.length > 0 && store.contactAnchors ? await store.contactAnchors(keys) : new Map() };
    const inboundEvents = p.extract(inbound, context);
    const threadIds = [...new Set(inboundEvents.map((e) => e.gmailThreadId))];
    const outbound = threadIds.length ? (await outboundOf(threadIds)).filter(allowed) : [];
    let events = tagEvents(p.extract([...inbound, ...outbound], context), via);
    const ruleEvents = events; // what the rule reader said, before any second reader touched it (the ledger records both sides)
    let chunkOpinions = new Map<string, import("../recruiting/reader/types.ts").VerifiedOutput>();
    let semanticFailed = false;
    if (p.semantic) {
      try {
        const inputs = semanticInputs(inbound, p.selfNames);
        let opinions: Map<string, import("../recruiting/reader/types.ts").VerifiedOutput>;
        if (p.semantic.readings) {
          const readings = await p.semantic.readings(inputs);
          for (const [k, v] of readings) readingLog.set(k, v);
          opinions = new Map([...readings].map(([k, v]) => [k, v.output] as const));
        } else opinions = await p.semantic.opine(inputs);
        chunkOpinions = opinions;
        for (const [k, v] of opinions) opinionLog.set(k, v); // kept for this run so the deferred pass can use them without a second call
        events = (p.semanticMode === "assist" ? applyAssist : applyConsensus)(events, inbound, opinions);
        if (readingLog.size > 0) events = reconcileReadings(events, readingLog);
      } catch {
        // A second opinion that fails is no opinion: the first reader's result stands and nothing is lost.
        semanticFailed = true; // and these messages are not remembered as evaluated, so the next run offers them to the model again
      }
    }
    if (p.identity) events = p.identity(events, new Map(inbound.map((m) => [m.id, m] as const)), readingLog);
    if (p.ledger && store.saveLedgers) {
      try { await store.saveLedgers(buildChunkLedgers(inbound, ruleEvents, chunkOpinions)); } catch { /* the ledger is a shadow record: losing it never fails or alters a sync */ }
    }
    await store.saveEvents(events);
    const eventIds = new Set(events.filter((e) => !isNearMiss(e)).map((e) => e.gmailMessageId)); // a near miss is still "no event" for continuity
    const held = p.deferable ? inbound.filter((e) => !eventIds.has(e.id) && deferred.size < DEFER_MAX && p.deferable!(e)) : [];
    for (const h of held) deferred.set(h.id, h);
    const heldIds = new Set(held.map((h) => h.id));
    try {
      if (!(semanticFailed && p.semanticMode === "assist")) await store.savePredictions(minimizeSweepPredictions(reconcilePredictions(p.predict([...inbound, ...outbound]), events), via).filter((pr) => !heldIds.has(pr.gmailMessageId)));
    } catch {
      // The prediction log is evaluation evidence and the "already evaluated" memory: losing it only costs a re-read next time.
    }
    await store.prune(inbound.map((e) => e.id), events.map((e) => e.gmailMessageId));
    for (const t of threadIds) handledThreads.add(t);
    fetched += chunk.ids.length;
    handledUnknown += chunk.unknown;
  }

  // Held messages, judged again now that this run's anchors are stored (order no longer matters within a run).
  if (deferred.size > 0) {
    const held = [...deferred.values()];
    const keys = contactKeysOf(held);
    let events = tagEvents(p.extract(held, { contacts: keys.length > 0 && store.contactAnchors ? await store.contactAnchors(keys) : new Map() }), via);
    if (p.semantic && opinionLog.size > 0) events = (p.semanticMode === "assist" ? applyAssist : applyConsensus)(events, held, new Map(held.flatMap((h) => (opinionLog.has(h.id) ? [[h.id, opinionLog.get(h.id)!] as const] : []))));
    if (p.semantic && readingLog.size > 0) events = reconcileReadings(events, new Map(held.flatMap((h) => (readingLog.has(h.id) ? [[h.id, readingLog.get(h.id)!] as const] : []))));
    if (p.identity) events = p.identity(events, new Map(held.map((m) => [m.id, m] as const)), readingLog);
    await store.saveEvents(events);
    try {
      await store.savePredictions(minimizeSweepPredictions(reconcilePredictions(p.predict(held), events), via));
    } catch {
      // as above: only costs a re-read
    }
  }

  // Replies to recently active threads, which no new inbound message would otherwise reveal.
  let repliesFound = 0;
  const anchors = (await store.recentAnchors(p.recentDays)).filter((a) => !handledThreads.has(a.gmailThreadId));
  if (anchors.length > 0) {
    const byThread = new Map(anchors.map((a) => [a.gmailThreadId, a]));
    const replies = (await outboundOf([...byThread.keys()])).filter(allowed);
    const events = replies.flatMap((e) => (byThread.has(e.threadId) ? [p.outboundEvent(e, byThread.get(e.threadId)!)] : []));
    await store.saveEvents(events);
    repliesFound = events.length;
  }

  await store.inheritRoles();
  const { events } = await store.finish(refs.length);
  return { scanned: refs.length, reused: refs.length - plan.chunks.reduce((n, c) => n + c.ids.length, 0), fetched, remaining: plan.unknown - handledUnknown, repliesFound, events, failed: failedIds.size, repliesUnchecked, truncated };
}
