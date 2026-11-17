import { RECRUITING_QUERY } from "./queries.ts";
import { SWEEP_MAX, mergeTiers, type DiscoveryMode } from "../discovery/strategy.ts";
import { queryMatcher } from "./sample.ts";
import { sampleEmails } from "../recruiting/sample-mailbox.ts";
import type { MailSource } from "../recruiting/sync-engine.ts";

/**
 * A MailSource over the synthetic sample mailbox. No network, no Google. Same contract as the real one: the search is the
 * product's real query, inbound mail comes with bodies, and the user's own replies come back metadata-only (empty body).
 * `anchor` is "today" for the mailbox (the sample connection's time), so dates stay current without changing between syncs.
 */
export function sampleMailSource(anchor: Date, mode: DiscoveryMode = "keyword"): MailSource {
  const all = sampleEmails(anchor);
  const matches = queryMatcher(RECRUITING_QUERY);
  const byId = new Map(all.map((e) => [e.id, e]));
  return {
    async listCandidates(max) {
      const newest = (xs: typeof all, n: number) => xs.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0, n).map((e) => ({ id: e.id, threadId: e.threadId }));
      const keyword = newest(all.filter((e) => !e.outbound && matches(e)), max);
      if (mode !== "sweep") return keyword;
      return mergeTiers(keyword, newest(all.filter((e) => !e.outbound && !isSamplePromotion(e.from)), SWEEP_MAX));
    },
    async fetchEmails(ids) {
      const emails = ids.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
      return { emails, missing: ids.filter((id) => !byId.has(id)) };
    },
    async fetchOutbound(threadIds) {
      const wanted = new Set(threadIds);
      return all.filter((e) => e.outbound && wanted.has(e.threadId)).map((e) => ({ ...e, bodyText: "" }));
    },
  };
}

/**
 * What Gmail's own classifier files under Promotions, Social or Forums, for the synthetic mailbox: bulk senders of shopping,
 * digests, job alerts and course marketing. The sweep excludes these server-side, exactly as `-category:promotions` does for
 * a real mailbox. Security alerts and statements are not promotions, so the sweep does read them (and the reader rejects them).
 */
const SAMPLE_PROMOTION_SENDERS = /nike\.com|dailydev\.io|joinhandshake\.com|linkedin\.com|coursera\.org|amazon\.com/i;
export const isSamplePromotion = (from: string) => SAMPLE_PROMOTION_SENDERS.test(from);
