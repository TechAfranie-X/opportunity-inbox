/**
 * EXPERIMENT, REJECTED ON DEVELOPMENT EVIDENCE. Not used by the pipeline (see pipeline.ts) and not to be wired in.
 * Kept so the result is reproducible (`npm run arch -- compare`, `adj-wrong`). On the 34 development messages that needed
 * it, the adjudicator decided 30 and was right 12 times; in 11 of the 12 right verdicts it sided with the language model,
 * so it added little independent evidence, and its guide conflicted with how development labels treat programs and
 * fellowships. Forced decisions cost 11-25 errors per 1,000 messages versus 7 for consensus-and-review.
 * Details: docs/architecture-milestone-2.md.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDir, writePrivateFile } from "../../eval-store/private-fs.ts";
import { parseSender } from "../../opportunities/normalize.ts";
import type { RecruitingEmail } from "../types.ts";
import { norm } from "./verify.ts";
import { redact } from "./redact.ts";
import type { Certainty, ReaderType, VerifiedOutput } from "./types.ts";

/**
 * Adjudication: a third, targeted read that runs ONLY when the two first-pass readers disagree or the model abstains
 * (a few percent of mail). The first-pass models are cheap and see a short excerpt; the adjudicator sees a longer one,
 * a little thread context, and both readers' claims, and must answer one narrow question with a verbatim quote.
 *
 * Why it exists: on development data neither reader is reliably right when they disagree (rules right 18, model right
 * 10 of 28), and on the held-out mailbox the model was right every time. No fixed "who wins" rule is supported by
 * both, so the disagreement needs evidence, not a default. Anything the adjudicator cannot back with a quote stays in review.
 */
export const ADJ_BODY_CHARS = 3200;
export const ADJ_THREAD_ITEMS = 3;
export const ADJ_THREAD_CHARS = 160;

export const YES_REASONS = ["own_hiring_process", "hire_completion_step", "recruiter_outreach_to_me"] as const;
export const NO_REASONS = ["not_employment", "employed_admin", "marketing_or_broadcast", "not_about_recipient", "no_hiring_content"] as const;
export type YesReason = (typeof YES_REASONS)[number];
export type NoReason = (typeof NO_REASONS)[number];

export const ADJUDICATION_GUIDE = `# Adjudication guide (Opportunity Inbox)
You read ONE email sent to ONE job-seeking student. Two earlier readers disagree about whether it is recruiting mail, or one could not decide. You decide, and you must justify the decision with a quote copied exactly from the email. Redactions such as [link], [email], [num] and [candidate] are intentional.

## The question
Is this email genuinely part of THIS person's own hiring process for a job, internship or paid project, or direct outreach from an employer or recruiter offering them one?
YES (give one reason):
 - own_hiring_process: an application, assessment, interview, offer, rejection, withdrawal or status update about their own application.
 - hire_completion_step: a step that completes a hire BEFORE the job starts, such as background screening requested by the employer, employment-eligibility paperwork, offer or onboarding paperwork, start-date confirmation, pre-employment screening.
 - recruiter_outreach_to_me: a recruiter or employer contacting them personally about a role.
NO (give one reason):
 - not_employment: a course, bootcamp, cohort, fellowship-as-training, scholarship, prize, honor society, school admission, community program or event, even when it uses words like interview, assessment, application, acceptance or next steps.
 - employed_admin: administration of a job they have ALREADY started (orientation or kickoff sessions, equipment, payroll, benefits, rewards, timekeeping, work-authorization paperwork for a current role).
 - marketing_or_broadcast: marketing, newsletters, job-alert digests, talent-community or career-fair promotion, generic "applications are open" broadcasts, offers of products.
 - not_about_recipient: not about this person's own process (a forwarded message, someone else's matter, a receipt or security notice).
 - no_hiring_content: nothing about hiring.
UNSURE: only if the email truly does not settle it. Do not guess.

## Rules
Classify by the actual content, not by subject wording or by which earlier reader sounds more confident. The earlier readers can both be wrong. The claims below are evidence about THEM, not about the email.
Never invent. evidence_quote must be copied exactly from the email text and must be the words that settle your decision.
certainty is "high", "medium" or "low".
`;

export const ADJUDICATION_OUTPUT_SPEC = `One JSON object per input line, on one line, with exactly these keys: {"key": <input key>, "verdict": "yes"|"no"|"unsure", "reason": <one reason from the guide, or "cannot_tell" for unsure>, "evidence_quote": <exact text copied from the email, or null only when unsure>, "certainty": "high"|"medium"|"low"}`;

export const ADJUDICATION_VERSION = `adj-${createHash("sha256").update(ADJUDICATION_GUIDE + ADJUDICATION_OUTPUT_SPEC).digest("hex").slice(0, 12)}`;

export type Claim = { reader: "pattern matcher" | "language model"; says: "recruiting" | "not recruiting" | "could not decide"; basis: string };
export type AdjudicationInput = {
  key: string;
  from: string;
  subject: string;
  body: string;
  received: string;
  thread: Array<{ from: string; subject: string; snippet: string }>;
  claims: Claim[];
};

const h = (s: string) => createHash("sha256").update(s).digest("hex");

/** Claims are presented in an order fixed by the key's hash, so neither reader is systematically first. */
export function buildClaims(key: string, rules: { recruiting: boolean; type: string | null; signals: string[] }, model: VerifiedOutput | null): Claim[] {
  const pattern: Claim = {
    reader: "pattern matcher",
    says: rules.recruiting ? "recruiting" : "not recruiting",
    basis: rules.recruiting ? `matched hiring-style phrases (${rules.signals.slice(0, 4).join(", ") || "none listed"}); guessed type: ${rules.type ?? "none"}` : "found no hiring-style phrases",
  };
  const lang: Claim = !model || model.status !== "ok" || model.certainty === "low"
    ? { reader: "language model", says: "could not decide", basis: "gave no verified answer" }
    : { reader: "language model", says: model.recruiting ? "recruiting" : "not recruiting", basis: model.recruiting ? `type: ${model.type ?? "unclear"}; certainty: ${model.certainty}` : `certainty: ${model.certainty}` };
  return parseInt(h(key).slice(0, 2), 16) % 2 === 0 ? [pattern, lang] : [lang, pattern];
}

export function buildAdjudicationInput(
  email: RecruitingEmail, key: string, threadMates: RecruitingEmail[], claims: Claim[], selfNames: string[] = [],
): AdjudicationInput {
  const sender = parseSender(email.from);
  const display = redact(email.from.replace(/<[^>]*>/, ""), selfNames).replace(/["']/g, "").trim();
  return {
    key,
    from: `${display} @${sender.domain}`.trim(),
    subject: redact(email.subject, selfNames),
    body: redact(email.bodyText, selfNames).slice(0, ADJ_BODY_CHARS),
    received: email.receivedAt.toISOString(),
    thread: threadMates
      .filter((m) => m.id !== email.id)
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .slice(0, ADJ_THREAD_ITEMS)
      .map((m) => ({ from: m.outbound ? "(the recipient)" : `@${parseSender(m.from).domain}`, subject: redact(m.subject, selfNames).slice(0, 100), snippet: redact(m.bodyText, selfNames).slice(0, ADJ_THREAD_CHARS) })),
    claims,
  };
}

export type RawAdjudication = { key?: unknown; verdict?: unknown; reason?: unknown; evidence_quote?: unknown; certainty?: unknown };
export type VerifiedAdjudication = {
  key: string;
  status: "ok" | "invalid" | "unsupported";
  verdict: "yes" | "no" | "unsure";
  reason: YesReason | NoReason | null;
  certainty: Certainty;
  evidence: { hash: string; offset: number } | null;
  rejections: string[];
};

/**
 * Deterministic gate on the adjudicator, in the same spirit as verifyOutput: a verdict stands only if its reason is
 * consistent with it and its quote is really in the message. Otherwise the message stays in review.
 */
export function verifyAdjudication(raw: unknown, input: AdjudicationInput): VerifiedAdjudication {
  const base: VerifiedAdjudication = { key: input.key, status: "invalid", verdict: "unsure", reason: null, certainty: "low", evidence: null, rejections: [] };
  const rej = base.rejections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { rej.push("schema:not_object"); return base; }
  const o = raw as RawAdjudication;
  if (o.key !== input.key) { rej.push("schema:key_mismatch"); return base; }
  if (o.verdict !== "yes" && o.verdict !== "no" && o.verdict !== "unsure") { rej.push("schema:verdict"); return base; }
  if (o.certainty !== "high" && o.certainty !== "medium" && o.certainty !== "low") { rej.push("schema:certainty"); return base; }
  base.certainty = o.certainty;
  if (o.verdict === "unsure") { base.status = "ok"; return base; }

  const reasons: readonly string[] = o.verdict === "yes" ? YES_REASONS : NO_REASONS;
  if (typeof o.reason !== "string" || !reasons.includes(o.reason)) { rej.push("reason:inconsistent_with_verdict"); return base; }
  const hay = norm(`${input.from}\n${input.subject}\n${input.body}\n${input.thread.map((t) => `${t.subject}\n${t.snippet}`).join("\n")}`);
  const q = typeof o.evidence_quote === "string" ? norm(o.evidence_quote) : "";
  const at = q.length >= 4 ? hay.indexOf(q) : -1;
  if (at < 0) { rej.push(q ? "evidence:not_in_text" : "evidence:missing"); base.status = "unsupported"; return base; }
  base.status = "ok";
  base.verdict = o.verdict;
  base.reason = o.reason as YesReason | NoReason;
  base.evidence = { hash: h(q).slice(0, 16), offset: at };
  return base;
}

// ---- cache of VERIFIED adjudications (never the input, never quote text) ----
export const adjCacheDir = () => process.env.ADJ_CACHE_DIR ?? join(homedir(), ".opportunity-inbox", "eval", "adjudication-cache", ADJUDICATION_VERSION);
export const adjInputHash = (i: AdjudicationInput) => h(JSON.stringify({ f: i.from, s: i.subject, b: i.body, r: i.received, t: i.thread, c: i.claims })).slice(0, 24);
const adjFile = (i: AdjudicationInput) => join(adjCacheDir(), `${adjInputHash(i)}.json`);

export function putAdjudication(input: AdjudicationInput, out: VerifiedAdjudication) {
  ensurePrivateDir(adjCacheDir());
  writePrivateFile(adjFile(input), JSON.stringify({ version: ADJUDICATION_VERSION, output: { ...out, key: undefined } }));
}

export function getAdjudication(input: AdjudicationInput): VerifiedAdjudication | null {
  const path = adjFile(input);
  if (!existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, "utf8"));
  return j.version === ADJUDICATION_VERSION ? { ...j.output, key: input.key } : null;
}

export type { ReaderType };
