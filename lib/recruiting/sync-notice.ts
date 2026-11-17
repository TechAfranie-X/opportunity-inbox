import type { EngineResult } from "./sync-engine.ts";

/**
 * What the person should be told when a read did not fully complete. Silent partial reads are the worst kind of failure: the
 * product would look finished while an application, a reply or a stretch of old mail was never looked at. Counts only, no content.
 */
export function syncNotice(r: Pick<EngineResult, "failed" | "repliesUnchecked" | "truncated" | "remaining">): string | undefined {
  const parts: string[] = [];
  if (r.failed > 0) parts.push(`${r.failed} ${r.failed === 1 ? "email" : "emails"} could not be read. Refresh to try again.`);
  if (r.repliesUnchecked > 0) parts.push("Some of your replies could not be checked, so a reply reminder may be out of date.");
  if (r.truncated && r.remaining === 0) parts.push("Your mailbox has more mail than we read in one pass, so the oldest mail was not looked at.");
  return parts.length > 0 ? parts.join(" ") : undefined;
}
