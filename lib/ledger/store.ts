import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { evidenceLedgers } from "@/lib/db/schema";
import { DECISION_VERSION } from "@/lib/decision/config";
import type { Verdict } from "@/lib/decision/engine";
import type { LedgerEntry } from "./chunk";
import { parseLedger } from "./types";

/**
 * Persistence for the evidence ledger. Every function takes the account (`userGoogleSub`) and filters on it: one account can never read, overwrite or delete another's ledger.
 * Every write passes `parseLedger` first, which refuses anything that could carry message content.
 */
/** `readerVersion`: the version the sync is running under (the same one the prediction log and the "already evaluated" memory use); the ledger follows it. */
export async function saveEvidenceLedgers(userGoogleSub: string, entries: LedgerEntry[], readerVersion?: string): Promise<number> {
  const rows = entries.flatMap(({ ledger, verdict }) => {
    const clean = parseLedger(readerVersion ? { ...ledger, readerVersion } : ledger); // throws on content-shaped data: the caller treats a ledger failure as "nothing recorded", never as a sync failure
    return [{ userGoogleSub, gmailMessageId: clean.messageId, gmailThreadId: clean.threadId, readerVersion: clean.readerVersion, decisionVersion: DECISION_VERSION, receivedAt: new Date(clean.receivedAt), senderDomain: clean.senderDomain, outbound: clean.outbound, claims: clean.claims as unknown[], verdict: verdict as unknown as Record<string, unknown> }];
  });
  if (rows.length === 0) return 0;
  await getDb().insert(evidenceLedgers).values(rows).onConflictDoUpdate({
    target: [evidenceLedgers.userGoogleSub, evidenceLedgers.gmailMessageId, evidenceLedgers.readerVersion],
    set: { claims: sql`excluded.claims`, verdict: sql`excluded.verdict`, decisionVersion: sql`excluded.decision_version`, recordedAt: sql`now()` },
  });
  return rows.length;
}

export async function loadEvidenceLedgers(userGoogleSub: string, readerVersion?: string): Promise<LedgerEntry[]> {
  const rows = await getDb().select().from(evidenceLedgers).where(readerVersion ? and(eq(evidenceLedgers.userGoogleSub, userGoogleSub), eq(evidenceLedgers.readerVersion, readerVersion)) : eq(evidenceLedgers.userGoogleSub, userGoogleSub));
  return rows.map((r) => ({ ledger: parseLedger({ version: 1, messageId: r.gmailMessageId, threadId: r.gmailThreadId, receivedAt: r.receivedAt.toISOString(), outbound: r.outbound, senderDomain: r.senderDomain, readerVersion: r.readerVersion, claims: r.claims }), verdict: r.verdict as unknown as Verdict }));
}

export async function deleteEvidenceLedgers(userGoogleSub: string): Promise<void> {
  await getDb().delete(evidenceLedgers).where(eq(evidenceLedgers.userGoogleSub, userGoogleSub));
}
