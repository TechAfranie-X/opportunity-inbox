import { RECRUITING_QUERY } from "./queries.ts";
import { queryMatcher } from "./sample.ts";
import { sampleEmails } from "../recruiting/sample-mailbox.ts";
import type { MailSource } from "../recruiting/sync-engine.ts";

/**
 * A MailSource over the synthetic sample mailbox. No network, no Google. Same contract as the real one: the search is the
 * product's real query, inbound mail comes with bodies, and the user's own replies come back metadata-only (empty body).
 * `anchor` is "today" for the mailbox (the sample connection's time), so dates stay current without changing between syncs.
 */
export function sampleMailSource(anchor: Date): MailSource {
  const all = sampleEmails(anchor);
  const matches = queryMatcher(RECRUITING_QUERY);
  const byId = new Map(all.map((e) => [e.id, e]));
  return {
    async listCandidates(max) {
      return all
        .filter((e) => !e.outbound && matches(e))
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
        .slice(0, max)
        .map((e) => ({ id: e.id, threadId: e.threadId }));
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
