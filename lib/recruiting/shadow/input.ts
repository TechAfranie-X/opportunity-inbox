import { resolveBatch } from "../entity/resolve.ts";
import { sameOrg } from "../reader/reconcile.ts";
import { sha } from "../reader/guide.ts";
import { READER_VERSION_V3 } from "../reader/guide3.ts";
import { buildReaderInput } from "../reader/redact.ts";
import type { ReaderInput } from "../reader/types.ts";
import type { RecruitingEmail } from "../types.ts";

/** Stable, opaque key for one shadow read; ties a worker output line to its input without exposing the message id. */
export const shadowKey = (userSub: string, messageId: string) => `s${sha(`${READER_VERSION_V3}:${userSub}:${messageId}`).slice(0, 10)}`;

/**
 * The only thing a model ever sees: a minimized, redacted excerpt plus employer candidates from the deterministic
 * resolver. Built on demand from the message and never persisted by the application.
 */
export function buildShadowInput(email: RecruitingEmail, key: string, threadMessages: number, selfNames: string[]): ReaderInput {
  const r = resolveBatch([{ id: email.id, threadId: email.threadId, from: email.from, replyTo: email.replyTo, subject: email.subject, body: email.bodyText }]).get(email.id);
  const names: string[] = [];
  for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name), ...(r?.evidence ?? []).filter((e) => e.weight >= 0.3).map((e) => e.name)]) {
    if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
  }
  return buildReaderInput(email, key, names, threadMessages, selfNames);
}
