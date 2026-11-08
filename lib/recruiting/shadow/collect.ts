import "server-only";

import { getGmailRefreshToken } from "@/lib/gmail/credentials";
import { refreshGmailAccessToken } from "@/lib/gmail/oauth";
import { RECRUITING_QUERY, fetchEmailsById, fetchMessageMetadata, listMessageRefs } from "@/lib/gmail/recruiting-source";
import { CANDIDATE_QUERY_V2 } from "@/lib/recruiting/reader/triage";
import { insertShadowReads, knownMessageIds } from "./store";
import { readShadowConfig } from "./config";
import { recordForCandidate, recordForLegacyOnly, recordForNonCandidate, uniformArm, type ShadowRecord } from "./shadow";

export type CollectSummary = {
  skipped?: "not_connected";
  candidatesListed: number;
  newCandidates: number;
  legacyOnly: number;
  stored: number;
  plannedReads: number;
  vetoed: number;
  universeSampled: number;
};

/**
 * Shadow collection for one mailbox. Reads Gmail with the same read-only scope as the product, keeps message bodies in
 * memory only, and stores routing, the rules' reading and sampling flags (never text). It does not touch the tables the
 * product reads, and a failure here must never affect a sync: callers swallow errors.
 *
 * `limit` bounds the work per run; the newest unseen candidates go first, so repeated runs backfill progressively.
 */
export async function collectShadow(userSub: string, opts: { limit?: number; maxList?: number } = {}): Promise<CollectSummary> {
  const cfg = readShadowConfig();
  const refresh = await getGmailRefreshToken(userSub);
  if (!refresh) return { skipped: "not_connected", candidatesListed: 0, newCandidates: 0, legacyOnly: 0, stored: 0, plannedReads: 0, vetoed: 0, universeSampled: 0 };
  const token = await refreshGmailAccessToken(refresh);

  const candidates = await listMessageRefs(token, opts.maxList ?? 1500, CANDIDATE_QUERY_V2);
  // What the CURRENT product would fetch: recorded so old-vs-v2 can be compared without running the old sync or showing anything.
  const legacy = await listMessageRefs(token, opts.maxList ?? 1500, RECRUITING_QUERY);
  const legacySet = new Set(legacy.map((m) => m.id));
  const candidateSet = new Set(candidates.map((c) => c.id));
  const known = await knownMessageIds(userSub);
  const fresh = [...candidates, ...legacy.filter((m) => !candidateSet.has(m.id))].filter((c) => !known.has(c.id)).slice(0, opts.limit ?? 150);

  const { emails } = await fetchEmailsById(token, fresh.map((c) => c.id)); // bodies live only inside this function
  const records: ShadowRecord[] = emails
    .filter((e) => !e.outbound)
    .map((e) => (candidateSet.has(e.id) ? recordForCandidate(userSub, e, cfg, legacySet.has(e.id)) : recordForLegacyOnly(userSub, e, cfg)));

  // Candidate-recall measurement needs mail the candidate query does NOT match, sampled by the deterministic arm. Only for
  // the prospective cohort, and only metadata (sender, arrival time) is fetched for it.
  let universeSampled = 0;
  if (cfg.cutoff) {
    const universe = await listMessageRefs(token, 20000, `after:${Math.floor(cfg.cutoff.getTime() / 1000)} -in:spam -in:trash -in:drafts -in:sent`);
    const wanted = universe.filter((m) => !candidateSet.has(m.id) && !legacySet.has(m.id) && !known.has(m.id) && uniformArm(userSub, m.id, cfg.uniformRate)).map((m) => m.id);
    for (const meta of await fetchMessageMetadata(token, wanted)) records.push(recordForNonCandidate(userSub, meta, cfg));
    universeSampled = wanted.length;
  }

  const stored = await insertShadowReads(records);
  const cand = records.filter((r) => r.isCandidate);
  return {
    candidatesListed: candidates.length,
    newCandidates: records.filter((r) => r.isCandidate).length,
    legacyOnly: records.filter((r) => !r.isCandidate).length,
    stored,
    plannedReads: cand.filter((r) => r.plannedRead).length,
    vetoed: cand.filter((r) => !r.plannedRead).length,
    universeSampled,
  };
}
