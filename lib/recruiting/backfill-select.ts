/** Bumped when the identity evidence changes, so a stored row is refreshed once per generation (idempotent within one). */
export const BACKFILL_MARK = "identity:backfilled:3";

/** Which stored rows a backfill may re-read: not already refreshed in this generation, and NEVER a row a person confirmed, corrected or ignored. Pure, so it is tested. */
export function selectBackfillCandidates<T extends { gmailMessageId: string; signals: string[] }>(rows: T[], corrected: ReadonlySet<string>, limit = 400): T[] {
  return rows.filter((e) => !e.signals.includes(BACKFILL_MARK) && !corrected.has(e.gmailMessageId)).slice(0, limit);
}
