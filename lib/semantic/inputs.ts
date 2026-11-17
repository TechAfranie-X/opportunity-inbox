import { resolveBatch } from "../recruiting/entity/resolve.ts";
import { planRead } from "../recruiting/reader/pipeline.ts";
import { buildReaderInput } from "../recruiting/reader/redact.ts";
import { sameOrg } from "../recruiting/reader/reconcile.ts";
import type { ReaderInput } from "../recruiting/reader/types.ts";
import type { RecruitingEmail } from "../recruiting/types.ts";

/**
 * What a second reader is allowed to see, and nothing else. Only messages that pass the veto-only triage (commerce, orders, security codes and
 * digests are never sent); each input is redacted and truncated (lib/recruiting/reader/redact.ts), and carries the deterministic resolver's
 * employer candidates so the reader chooses among grounded names instead of inventing one. The key is the message id and stays local.
 */
export function semanticInputs(emails: RecruitingEmail[], selfNames: string[] = []): ReaderInput[] {
  const eligible = emails.filter((e) => !e.outbound && planRead(e).read);
  if (eligible.length === 0) return [];
  const res = resolveBatch(eligible.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, replyTo: e.replyTo, subject: e.subject, body: e.bodyText })));
  const perThread = new Map<string, number>();
  for (const e of emails) perThread.set(e.threadId, (perThread.get(e.threadId) ?? 0) + 1);
  return eligible.map((e) => {
    const r = res.get(e.id);
    const names: string[] = [];
    for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name), ...(r?.evidence ?? []).filter((x) => x.weight >= 0.3).map((x) => x.name)]) if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
    return buildReaderInput(e, e.id, names, perThread.get(e.threadId) ?? 1, selfNames);
  });
}
