import "server-only";

import { GmailAccessError } from "@/lib/gmail/oauth";
import { embargoBefore } from "@/lib/gmail/embargo";
import { isSampleUser } from "@/lib/gmail/sample";
import { mailSourceFor } from "@/lib/gmail/source";
import { outboundEvent, isContinuityCandidate } from "@/lib/recruiting/extract";
import { readMail } from "@/lib/reliability/assess";
import { buildPredictions } from "@/lib/recruiting/predictions";
import { PRODUCT_READER_VERSION } from "@/lib/recruiting/product-version";
import { contactAnchors, countEvents, evaluatedMessageIds, inheritStoredRoles, markSynced, pruneReclassified, recentThreadAnchors, saveExtractedEvents, savePredictions } from "@/lib/recruiting/store";
import { runSync, type EngineResult, type SyncStore } from "@/lib/recruiting/sync-engine";

export type SyncResult =
  | ({ ok: true } & EngineResult)
  | { ok: false; reason: "not_connected" | "reconnect_required" | "temporary_error" };

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
