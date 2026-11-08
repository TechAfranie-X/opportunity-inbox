import "server-only";

import { getGmailRefreshToken } from "@/lib/gmail/credentials";
import { applyEmbargo } from "@/lib/gmail/embargo";
import { refreshGmailAccessToken } from "@/lib/gmail/oauth";
import { RECRUITING_QUERY, fetchEmailsById, fetchOutboundInThreads, listMessageRefs } from "@/lib/gmail/recruiting-source";
import type { MailSource } from "@/lib/recruiting/sync-engine";

/** Reply refresh can cover this many threads in one call. */
const OUTBOUND_THREADS = 400;

/** The real mailbox, read-only. The search is restricted by the evaluation embargo (a no-op until the cutoff). */
export function gmailMailSource(accessToken: string): MailSource {
  return {
    listCandidates: (max) => listMessageRefs(accessToken, max, applyEmbargo(RECRUITING_QUERY)),
    fetchEmails: (ids) => fetchEmailsById(accessToken, ids),
    fetchOutbound: (threadIds) => fetchOutboundInThreads(accessToken, threadIds, OUTBOUND_THREADS),
  };
}

/** The mail source for a signed-in user, or null when no mailbox is connected. */
export async function mailSourceFor(userGoogleSub: string): Promise<MailSource | null> {
  const refresh = await getGmailRefreshToken(userGoogleSub);
  if (!refresh) return null;
  return gmailMailSource(await refreshGmailAccessToken(refresh));
}
