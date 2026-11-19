import { mailSourceFor } from "@/lib/gmail/source";
import { loadUnjudgedNearMisses, saveExtractedEvents } from "@/lib/recruiting/store";
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
