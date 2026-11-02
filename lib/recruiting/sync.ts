import "server-only";

import { getGmailRefreshToken } from "@/lib/gmail/credentials";
import { GmailAccessError, refreshGmailAccessToken } from "@/lib/gmail/oauth";
import { fetchInboundCandidates, fetchOutboundInThreads } from "@/lib/gmail/recruiting-source";
import { extractAll } from "@/lib/recruiting/extract";
import { markSynced, pruneReclassified, saveExtractedEvents } from "@/lib/recruiting/store";

export type SyncResult =
  | { ok: true; scanned: number; events: number }
  | { ok: false; reason: "not_connected" | "reconnect_required" | "temporary_error" };

/**
 * Gmail -> structured events -> Postgres.
 *
 * Privacy contract: message bodies live only inside this function's call stack.
 * Only `ExtractedEvent` fields (no body text) reach the database.
 */
export async function syncRecruitingMail(userGoogleSub: string): Promise<SyncResult> {
  try {
    const refreshToken = await getGmailRefreshToken(userGoogleSub);
    if (!refreshToken) return { ok: false, reason: "not_connected" };

    const accessToken = await refreshGmailAccessToken(refreshToken);
    const inbound = await fetchInboundCandidates(accessToken);
    const inboundEvents = extractAll(inbound.emails);
    const outbound = await fetchOutboundInThreads(accessToken, inboundEvents.map((e) => e.gmailThreadId));
    const events = extractAll([...inbound.emails, ...outbound]);

    await saveExtractedEvents(userGoogleSub, events);
    await pruneReclassified(
      userGoogleSub,
      inbound.emails.map((e) => e.id),
      events.map((e) => e.gmailMessageId),
    );
    await markSynced(userGoogleSub, inbound.scanned, events.length);
    return { ok: true, scanned: inbound.scanned, events: events.length };
  } catch (error) {
    if (error instanceof GmailAccessError) {
      return { ok: false, reason: error.reason === "reconnect_required" ? "reconnect_required" : "temporary_error" };
    }
    // Never log message content; the error type alone is enough to debug.
    console.error("recruiting sync failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "temporary_error" };
  }
}
