import "server-only";

import { GmailAccessError } from "@/lib/gmail/oauth";
import { embargoBefore } from "@/lib/gmail/embargo";
import { isSampleUser } from "@/lib/gmail/sample";
import { mailSourceFor } from "@/lib/gmail/source";
import { outboundEvent, isContinuityCandidate } from "@/lib/recruiting/extract";
import { applyIdentity } from "@/lib/identity/reconcile";
import { learnedMappings } from "@/lib/identity/learned";
import { readMail } from "@/lib/reliability/assess";
import { cacheSemanticReader } from "@/lib/semantic/cache-reader";
import { sampleSemanticReader } from "@/lib/semantic/sample-reader";
import { buildPredictions } from "@/lib/recruiting/predictions";
import { PRODUCT_READER_VERSION } from "@/lib/recruiting/product-version";
import { contactAnchors, countEvents, evaluatedMessageIds, inheritStoredRoles, loadWorkspace, markSynced, pruneReclassified, recentThreadAnchors, saveExtractedEvents, savePredictions } from "@/lib/recruiting/store";
import { runSync, type EngineResult, type SyncStore } from "@/lib/recruiting/sync-engine";

export type SyncResult =
  | ({ ok: true } & EngineResult)
  | { ok: false; reason: "not_connected" | "reconnect_required" | "temporary_error" };

/**
 * The second reader is OFF unless SEMANTIC_READER names an adapter, and never in production. "cache" serves verified outputs from the
 * development harness cache; "sample" is a scripted stand-in for the synthetic sample mailbox only. No model is hosted, called or paid for.
 */
function semanticConfig(sub: string): Partial<Pick<Parameters<typeof runSync>[2], "semantic" | "selfNames">> {
  if (process.env.NODE_ENV === "production") return {};
  const selfNames = (process.env.READER_SELF_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.SEMANTIC_READER === "cache") return { semantic: cacheSemanticReader(), selfNames };
  if (process.env.SEMANTIC_READER === "sample" && isSampleUser(sub)) return { semantic: sampleSemanticReader(), selfNames };
  return {};
}

/**
 * Employer resolution (lib/identity) is ON by default: it is local, pure and free, and it only ever lowers confidence or fills a company as "likely",
 * never overturning a confident reading silently. IDENTITY=off returns to the previous behavior. It uses the person's own opportunities (to raise belief
 * in a company they already have) and their own corrections (learned mappings); nothing leaves the machine and nothing is shared between people.
 */
async function identityConfig(sub: string): Promise<Pick<Parameters<typeof runSync>[2], "identity">> {
  if (process.env.IDENTITY === "off") return {};
  try {
    const ws = await loadWorkspace(sub);
    const ctx = {
      known: [...new Set(ws.opportunities.map((o) => o.company).filter((c) => c && c !== "Unknown company"))],
      learned: learnedMappings(ws.opportunities.flatMap((o) => o.events)),
    };
    return { identity: (events, emails, readings) => applyIdentity(events, emails, readings, ctx) };
  } catch {
    return {}; // no identity layer is better than no sync
  }
}

/** One request reads at most this long, then reports what is left and lets the caller continue. */
const BUDGET_MS = 150_000;
const MAX_CANDIDATES = 600;
const THREADS_PER_CHUNK = 20;
const RECENT_DAYS = 30;

const storeFor = (sub: string, readerVersion: string): SyncStore => ({
  evaluatedIds: (ids) => evaluatedMessageIds(sub, ids, readerVersion),
  saveEvents: (events) => saveExtractedEvents(sub, events),
  savePredictions: async (p) => { await savePredictions(sub, p); },
  prune: async (scanned, kept) => { await pruneReclassified(sub, scanned, kept); },
  recentAnchors: (days) => recentThreadAnchors(sub, days),
  contactAnchors: (keys) => contactAnchors(sub, keys),
  inheritRoles: async () => { await inheritStoredRoles(sub); },
  finish: async (scanned) => {
    const events = await countEvents(sub);
    await markSynced(sub, scanned, events);
    return { events };
  },
});

/**
 * Gmail -> structured events -> Postgres, incrementally (see lib/recruiting/sync-engine.ts for the rules).
 *
 * Privacy contract: message bodies live only inside the engine's call stack. Only `ExtractedEvent` fields (no body text)
 * reach the database.
 */
export async function syncRecruitingMail(userGoogleSub: string, opts: { /** Test seam: run as a different reader version, which is exactly what a reader upgrade does. */ readerVersion?: string } = {}): Promise<SyncResult> {
  const readerVersion = opts.readerVersion ?? PRODUCT_READER_VERSION;
  try {
    const source = await mailSourceFor(userGoogleSub);
    if (!source) return { ok: false, reason: "not_connected" };
    const result = await runSync(source, storeFor(userGoogleSub, readerVersion), {
      maxCandidates: MAX_CANDIDATES,
      threadsPerChunk: THREADS_PER_CHUNK,
      budgetMs: BUDGET_MS,
      recentDays: RECENT_DAYS,
      // The embargo protects real evaluation mail; the synthetic sample mailbox is not evaluation mail and must keep working after the cutoff.
      embargoBefore: isSampleUser(userGoogleSub) ? null : embargoBefore(),
      extract: readMail,
      deferable: isContinuityCandidate,
      // The second reader is OFF unless SEMANTIC_READER names an adapter. The only adapter is the development cache (never production):
      // no model is hosted, called or paid for. See lib/semantic/port.ts for the contract any real adapter must honour.
      ...semanticConfig(userGoogleSub),
      ...(await identityConfig(userGoogleSub)),
      predict: (emails) => buildPredictions(emails, readerVersion),
      outboundEvent,
    });
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof GmailAccessError) {
      return { ok: false, reason: error.reason === "reconnect_required" ? "reconnect_required" : "temporary_error" };
    }
    // Never log message content; the error type alone is enough to debug.
    console.error("recruiting sync failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "temporary_error" };
  }
}
