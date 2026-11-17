import "server-only";

import { findGmailConnection, getGmailRefreshToken } from "@/lib/gmail/credentials";
import { isSampleUser } from "@/lib/gmail/sample";
import { sampleMailSource } from "@/lib/gmail/sample-source";
import { applyEmbargo } from "@/lib/gmail/embargo";
import { refreshGmailAccessToken } from "@/lib/gmail/oauth";
import { RECRUITING_QUERY, fetchEmailsById, fetchOutboundInThreads, listMessageRefs } from "@/lib/gmail/recruiting-source";
import { SWEEP_MAX, SWEEP_QUERY, discoveryMode, mergeTiers, type DiscoveryMode } from "@/lib/discovery/strategy";
import type { MailSource } from "@/lib/recruiting/sync-engine";

/** Reply refresh can cover this many threads in one call. */
const OUTBOUND_THREADS = 400;

/** The real mailbox, read-only. The search is restricted by the evaluation embargo (a no-op until the cutoff). */
export function gmailMailSource(accessToken: string, mode: DiscoveryMode = discoveryMode()): MailSource {
  return {
    async listCandidates(max) {
      const keyword = await listMessageRefs(accessToken, max, applyEmbargo(RECRUITING_QUERY));
      if (mode !== "sweep") return keyword;
      // Keyword hits first (they are read first), then everything Gmail does not file as Promotions, Social or Forums.
      return mergeTiers(keyword, await listMessageRefs(accessToken, SWEEP_MAX, applyEmbargo(SWEEP_QUERY)));
    },
    fetchEmails: (ids) => fetchEmailsById(accessToken, ids),
    fetchOutbound: (threadIds) => fetchOutboundInThreads(accessToken, threadIds, OUTBOUND_THREADS),
  };
}

/** The mail source for a signed-in user, or null when no mailbox is connected. */
export async function mailSourceFor(userGoogleSub: string): Promise<MailSource | null> {
  if (isSampleUser(userGoogleSub)) {
    // Sample users never reach Google: their mailbox is synthetic, anchored at when the sample was started.
    const connection = await findGmailConnection(userGoogleSub);
    return connection ? sampleMailSource(connection.connectedAt, discoveryMode()) : null;
  }
  const refresh = await getGmailRefreshToken(userGoogleSub);
  if (!refresh) return null;
  return gmailMailSource(await refreshGmailAccessToken(refresh));
}
