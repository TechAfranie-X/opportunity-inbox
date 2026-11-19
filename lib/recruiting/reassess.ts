import { mailSourceFor } from "@/lib/gmail/source";
import { loadAllExtracted, loadCorrectedMessageIds, loadUnjudgedNearMisses, saveExtractedEvents } from "@/lib/recruiting/store";
import { readMail } from "@/lib/reliability/assess";
import { isNearMiss } from "@/lib/reliability/flags";
import type { ExtractedEvent } from "@/lib/recruiting/types";
import { applyAssist } from "@/lib/semantic/assist";
import { reconcileReadings } from "@/lib/semantic/employer";
import { semanticInputs } from "@/lib/semantic/inputs";
import type { SemanticReader } from "@/lib/semantic/port";

/**
 * Re-read what is already stored as "possibly recruiting" with the language model. Messages the product set aside before a model existed (or while it was off)
 * are fetched from Gmail again, read IN MEMORY by the local model, and judged: not recruiting -> excluded from review (kept as metadata); recruiting with
 * high certainty -> a pipeline event; otherwise unchanged. Nothing is stored except the same metadata fields the product always stores. A person's
 * confirmation or correction is never touched (those rows are skipped), and Gmail is only read.
 */
export async function reassessPossible(userGoogleSub: string, reader: SemanticReader, selfNames: string[] = [], limit = 200): Promise<{ examined: number; excluded: number; promoted: number; asked: number; unreadable: number }> {
  const source = await mailSourceFor(userGoogleSub);
  if (!source) throw new Error("not connected");
  const near = (await loadUnjudgedNearMisses(userGoogleSub)).slice(0, limit);
  if (near.length === 0) return { examined: 0, excluded: 0, promoted: 0, asked: 0, unreadable: 0 };
  const { emails, failed } = await source.fetchEmails(near.map((e) => e.gmailMessageId));
  const inbound = emails.filter((e) => !e.outbound);
  const readings = await reader.readings!(semanticInputs(inbound, selfNames));
  const opinions = new Map([...readings].map(([k, v]) => [k, v.output] as const));
  const judged = reconcileReadings(applyAssist(near, inbound, opinions), readings);
  const changed = judged.filter((e, i) => e !== near[i] || e.signals.length !== near[i]?.signals.length);
  await saveExtractedEvents(userGoogleSub, judged.filter((e) => near.some((n) => n.gmailMessageId === e.gmailMessageId)));
  return {
    examined: near.length,
    excluded: judged.filter((e) => e.signals.includes("semantic:excluded")).length,
    promoted: judged.filter((e) => e.signals.includes("semantic:event")).length,
    asked: judged.filter((e) => e.signals.includes("semantic:yes")).length,
    unreadable: (failed?.length ?? 0) + near.length - inbound.length - changed.length * 0,
  };
}


/**
 * Identity backfill (Opportunity Intelligence v3). Events stored before employer provenance existed lack the evidence the identity layer weighs (where the employer
 * name came from, the sender's own label). Their messages are fetched again (Gmail is read-only), read IN MEMORY with the same reader the sync uses, and the stored
 * metadata fields are refreshed. Idempotent (running it twice changes nothing the second time), additive (it only UPDATES rows that already exist; it deletes nothing
 * and never touches a person's correction, which lives in its own column), and failure-closed (without a model reading for a message, its row is left as it was).
 */
/** Bumped when the identity evidence changes, so a stored row is refreshed once per generation (idempotent within one). */
const BACKFILL_MARK = "identity:backfilled:3";
export async function backfillIdentity(userGoogleSub: string, reader: SemanticReader | null, selfNames: string[] = [], limit = 400): Promise<{ examined: number; updated: number; skipped: number }> {
  const source = await mailSourceFor(userGoogleSub);
  if (!source) throw new Error("not connected");
  // A row a person confirmed or corrected is never re-read: a confirmation vouches for the reading it was made on, and a different reading would put words in their mouth.
  const corrected = await loadCorrectedMessageIds(userGoogleSub);
  const stored = (await loadAllExtracted(userGoogleSub)).filter((e) => !e.signals.includes(BACKFILL_MARK) && !corrected.has(e.gmailMessageId)).slice(0, limit);
  if (stored.length === 0) return { examined: 0, updated: 0, skipped: 0 };
  const { emails } = await source.fetchEmails(stored.map((e) => e.gmailMessageId));
  const inbound = emails.filter((e) => !e.outbound);
  let events = readMail(emails);
  if (reader) {
    const readings = await reader.readings!(semanticInputs(inbound, selfNames));
    events = reconcileReadings(applyAssist(events, emails, new Map([...readings].map(([k, v]) => [k, v.output] as const))), readings);
  }
  const old = new Map(stored.map((e) => [e.gmailMessageId, e] as const));
  // never DOWNGRADE: a message the product already shows (or one a model judged) is not replaced by a weaker reading of the same message
  const keeps = (e: ExtractedEvent) => { const o = old.get(e.gmailMessageId)!; return !(isNearMiss(e) && !isNearMiss(o)) && !(o.signals.some((x) => x.startsWith("semantic:")) && !e.signals.some((x) => x.startsWith("semantic:"))); };
  const fresh = events.filter((e) => old.has(e.gmailMessageId) && keeps(e)).map((e) => ({ ...e, signals: [...new Set([...e.signals, ...(old.get(e.gmailMessageId)!.signals.filter((x) => x.startsWith("via:"))), BACKFILL_MARK])] }));
  await saveExtractedEvents(userGoogleSub, fresh);
  return { examined: stored.length, updated: fresh.length, skipped: stored.length - fresh.length };
}
