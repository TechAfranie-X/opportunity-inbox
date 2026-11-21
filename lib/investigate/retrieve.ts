import { fetchEmailsById, fetchThreadMessages, listMessageRefs } from "../gmail/recruiting-source.ts";
import { readMail } from "../reliability/assess.ts";
import type { EffectiveEvent } from "../recruiting/types.ts";

/**
 * Targeted Gmail retrieval for the investigator, used only when stored evidence leaves a journey ambiguous or incomplete. Read-only (the Gmail scope is read-only), bounded (one thread fetch plus one
 * employer-scoped search of at most `max` messages), account-bound (the caller passes that account's token). Retrieved messages are read by the deterministic rule reader into EXTRA events that exist only
 * for this investigation: nothing is stored, no body is kept, and they never override a stored or corrected event.
 */
export async function retrieveRelated(token: string, seed: { gmailThreadId: string; company: string | null }, known: Set<string>, opts: { max?: number; sinceDays?: number } = {}): Promise<EffectiveEvent[]> {
  const max = opts.max ?? 40;
  const ids = new Set<string>();
  const threadMsgs = await fetchThreadMessages(token, [seed.gmailThreadId]).catch(() => []);
  for (const m of threadMsgs) if (!known.has(m.id)) ids.add(m.id);
  if (seed.company && !/^unknown/i.test(seed.company)) {
    const name = seed.company.replace(/["\\]/g, " ").trim();
    const refs = await listMessageRefs(token, max, `"${name}" newer_than:${opts.sinceDays ?? 400}d -in:chats -category:promotions`).catch(() => []);
    for (const r of refs) if (!known.has(r.id)) ids.add(r.id);
  }
  const todo = [...ids].slice(0, max);
  if (todo.length === 0) return [];
  const { emails } = await fetchEmailsById(token, todo);
  return readMail(emails).filter((e) => !e.outbound).map((e) => ({ ...e, id: `retrieved:${e.gmailMessageId}`, corrected: false, signals: [...e.signals, "retrieved:unstored"] }) as unknown as EffectiveEvent);
}
