import { parseSender } from "../../opportunities/normalize.ts";
import type { RecruitingEmail } from "../types.ts";
import type { ReaderInput } from "./types.ts";

export const MAX_BODY_CHARS = 1400;

/**
 * Minimization for the model: links, addresses, long numbers and the recipient's own name are removed, whitespace is
 * collapsed and the body is truncated. `selfNames` is supplied at run time (from the connected account), never hard-coded.
 */
export function redact(text: string, selfNames: string[] = []): string {
  let out = text
    .replace(/<?https?:\/\/[^\s>)]+>?/g, "[link]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\d{5,}/g, "[num]");
  const names = selfNames.map((n) => n.trim()).filter((n) => n.length >= 2).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (names.length > 0) out = out.replace(new RegExp(`\\b(?:${names.join("|")})\\b`, "gi"), "[candidate]");
  return out.replace(/&#\d+;|&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

export function buildReaderInput(email: RecruitingEmail, key: string, candidates: string[], threadMessages: number, selfNames: string[] = []): ReaderInput {
  const sender = parseSender(email.from);
  const display = redact(email.from.replace(/<[^>]*>/, ""), selfNames).replace(/["']/g, "").trim();
  return {
    key,
    from: `${display} @${sender.domain}`.trim(),
    subject: redact(email.subject, selfNames),
    body: redact(email.bodyText, selfNames).slice(0, MAX_BODY_CHARS),
    received: email.receivedAt.toISOString(),
    threadMessages,
    candidates: candidates.slice(0, 5).map((name, i) => ({ id: `c${i + 1}`, name: redact(name, selfNames) })),
  };
}
