import type { Prediction } from "../recruiting/predictions.ts";
import type { CandidateRef } from "../recruiting/sync-engine.ts";
import type { ExtractedEvent } from "../recruiting/types.ts";

/**
 * Candidate discovery: which messages get read at all.
 *
 * Every downstream stage (extraction, company, grouping, Today) only ever sees what discovery fetched, so a recruiting email
 * the search does not return is not misread, it is simply absent, and nothing in the product can reveal that. On the
 * development mailbox the keyword search (subject words or applicant-tracking senders) reached about 75% of the messages
 * labelled recruiting (58 of 77), see docs/discovery-v2.md.
 *
 * Two modes, selected by DISCOVERY (default "keyword", the behavior the product has always had):
 *  - keyword: the original search.
 *  - sweep:   the same search FIRST, then Gmail's own semantic filter (everything outside Promotions, Social and Forums), with
 *             no hiring vocabulary. The deterministic reader is the precision stage; nothing about how it reads changed.
 *
 * Privacy is unchanged in kind: bodies stay in memory during a sync. The only widening is metadata, and it is bounded: a
 * message read through the sweep and rejected is remembered by id alone (no sender domain), see `minimizeSweepPredictions`.
 */
export const DISCOVERY_VERSION = "discovery-2026.11.1-sweep";

export type Via = "keyword" | "sweep";
export type DiscoveryMode = "keyword" | "sweep";

export const discoveryMode = (env: Record<string, string | undefined> = process.env): DiscoveryMode => (env.DISCOVERY === "sweep" ? "sweep" : "keyword");

/** Semantic, recall-first: Gmail already separates Promotions, Social and Forums; nothing is filtered on hiring words. */
export const SWEEP_QUERY = ["newer_than:365d", "-in:spam -in:trash -in:drafts -in:sent", "-category:promotions -category:social -category:forums"].join(" ");

/** Ids the sweep will list per sync. Listing is cheap (ids only); reading is bounded by the sync's time budget and resumes. */
export const SWEEP_MAX = 4000;

/**
 * One candidate list, keyword hits first. The sync reads newest-first within the order it is given and stops at its time
 * budget, so the mail the product always found is still read first and a long sweep never delays it.
 */
export function mergeTiers(keyword: Array<{ id: string; threadId: string }>, sweep: Array<{ id: string; threadId: string }>): CandidateRef[] {
  const seen = new Set<string>();
  const out: CandidateRef[] = [];
  for (const r of keyword) if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, via: "keyword" }); }
  for (const r of sweep) if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, via: "sweep" }); }
  return out;
}

export const viaMap = (refs: CandidateRef[]): Map<string, Via> => new Map(refs.flatMap((r) => (r.via ? [[r.id, r.via] as const] : [])));

/** Provenance, written as a signal so it needs no schema change: which tier found each event. Unlabelled (keyword mode) stays byte-identical. */
export function tagEvents(events: ExtractedEvent[], via: Map<string, Via>): ExtractedEvent[] {
  if (via.size === 0) return events;
  return events.map((e) => {
    const v = via.get(e.gmailMessageId);
    return v ? { ...e, signals: [...e.signals.filter((s) => !s.startsWith("via:")), `via:${v}`] } : e;
  });
}

/**
 * Predictions for what was read. Provenance is recorded for all of them. For a message the sweep read and the reader rejected,
 * the sender domain is dropped: the prediction log only needs to know the message was already looked at, and keeping the
 * domains of someone's non-recruiting mail (banks, friends, shops) for a whole year would be new retention for no purpose.
 */
export function minimizeSweepPredictions(predictions: Prediction[], via: Map<string, Via>): Prediction[] {
  if (via.size === 0) return predictions;
  return predictions.map((p) => {
    const v = via.get(p.gmailMessageId);
    if (!v) return p;
    const signals = [...p.signals.filter((s) => !s.startsWith("via:")), `via:${v}`];
    return p.decision === "not_recruiting" && v === "sweep" ? { ...p, senderDomain: "", signals } : { ...p, signals };
  });
}
