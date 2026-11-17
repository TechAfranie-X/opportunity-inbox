/**
 * Shared by the intelligence experiments: run the product's real sync engine over a development dataset in memory and classify what
 * the person would see for each message. Development data only; aggregate output only.
 */
import { extractAll, inheritRoles, isContinuityCandidate, outboundEvent, type ThreadAnchor } from "../lib/recruiting/extract.ts";
import { buildPredictions, type Prediction } from "../lib/recruiting/predictions.ts";
import { runSync, type MailSource, type SyncStore } from "../lib/recruiting/sync-engine.ts";
import { eventNeedsReview } from "../lib/recruiting/opportunity.ts";
import { mergeTiers } from "../lib/discovery/strategy.ts";
import { matchesLegacyQuery } from "../lib/discovery/legacy-query.ts";
import { isNearMiss, isWeakNearMiss } from "../lib/reliability/flags.ts";
import { readMail } from "../lib/reliability/assess.ts";
import type { ExtractedEvent } from "../lib/recruiting/types.ts";
import type { SemanticReader } from "../lib/semantic/port.ts";
import { DEV, category, type Msg } from "./lab-data.ts";

export type Outcome = "event" | "event+review" | "near-strong" | "near-weak" | "none";

export async function runProduct(messages: Msg[], extract: typeof extractAll = readMail, semantic?: SemanticReader): Promise<Map<string, ExtractedEvent>> {
  const out = new Map<string, ExtractedEvent>();
  for (const ds of DEV) {
    const mail = messages.filter((m) => m.ds === ds);
    const newest = (xs: Msg[]) => [...xs].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((e) => ({ id: e.id, threadId: e.threadId }));
    const source: MailSource = {
      async listCandidates() { return mergeTiers(newest(mail.filter((m) => matchesLegacyQuery(m.from, m.subject))), newest(mail.filter(category))); },
      async fetchEmails(ids) { return { emails: mail.filter((e) => ids.includes(e.id)), missing: [] }; },
      async fetchOutbound() { return []; },
    };
    const events = new Map<string, ExtractedEvent>(), preds = new Map<string, Prediction>();
    const store: SyncStore = {
      async evaluatedIds(ids) { return new Set(ids.filter((i) => preds.has(i))); },
      async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
      async savePredictions(ps) { for (const p of ps) if (!preds.has(p.gmailMessageId)) preds.set(p.gmailMessageId, p); },
      async prune() {}, async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
      async inheritRoles() { inheritRoles([...events.values()]); }, async finish() { return { events: events.size }; },
      async contactAnchors(keys: string[]) {
        const m = new Map<string, ThreadAnchor>();
        for (const e of events.values()) for (const k of keys) if (e.signals.includes(k) && (!m.has(k) || (!m.get(k)!.company && e.company))) m.set(k, { gmailThreadId: e.gmailThreadId, company: e.company, role: e.role, confidence: e.confidence, fieldConfidence: e.fieldConfidence });
        return m;
      },
    };
    await runSync(source, store, { maxCandidates: 5000, threadsPerChunk: 20, budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract, deferable: isContinuityCandidate, predict: buildPredictions, outboundEvent, ...(semantic ? { semantic } : {}) });
    for (const [k, v] of events) out.set(`${ds}|${k}`, v);
  }
  return out;
}

export function outcomeOf(m: Msg, evs: Map<string, ExtractedEvent>): Outcome {
  const e = evs.get(`${m.ds}|${m.id}`);
  if (!e) return "none";
  if (isNearMiss(e)) return isWeakNearMiss(e) ? "near-weak" : "near-strong";
  return eventNeedsReview({ ...e, id: "x", corrected: false } as never) || !e.company ? "event+review" : "event";
}
