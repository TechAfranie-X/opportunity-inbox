import type { RecruitingEmail } from "../types.ts";

/**
 * Triage v2: decides which candidate messages are too obviously unrelated to hiring to be worth a model read.
 *
 * Design rule: this stage may only VETO, never select. A message is skipped only when it matches a high-precision noise
 * class AND carries no hiring signal. Anything unfamiliar passes, so a new kind of recruiting mail (one the authors never
 * thought of) is read by default instead of silently dropped. The frozen gate worked the other way round (it selected
 * on hiring vocabulary, and on rules agreeing), which is why mail phrased without that vocabulary never reached the model.
 *
 * A wrong veto costs recall; a wrong pass only costs a read. Keep every pattern narrow and every protection broad.
 */
export type TriageResult = { pass: boolean; reason: "protected" | "noise:commerce" | "noise:order" | "noise:security" | "noise:digest" | "unclassified" };

const PROTECT_SENDER = /(greenhouse|lever\.co|ashbyhq|icims|myworkday|workday|smartrecruiters|jobvite|taleo|successfactors|handshake|interfolio|modernloop|hackerrank|codesignal|hirevue|12twenty|oraclecloud|brassring|breezy|workable|bamboohr)/i;

/** Vocabulary of a person's own hiring process, including the steps that complete a hire. Broad on purpose: it only blocks a veto. */
const PROTECT_TEXT = /\b(appl(y|ied|ies|ication|ications|icant|icants|ying)|candidate|candidacy|interview|assessment|coding challenge|recruit\w*|hiring|talent|resume|cv|offer (letter|of employment)|your offer|background (check|verification|screen\w*)|screening|onboarding|new hire|employment|eligibility|i-?9|start date|first day|internship|fellowship|requisition|next steps|position)\b/i;

const NOISE: Array<[TriageResult["reason"], RegExp]> = [
  ["noise:commerce", /(\d+\s?%\s?off|\bsale\b|shop (now|the|our)|free shipping|promo code|coupon|limited[- ]time (offer|deal)|\bdeals? (for you|of the day)|gift card|rewards? points?|clearance|new arrivals)/i],
  ["noise:order", /(order (confirmation|#\s?\d|number|has shipped|status)|tracking (number|id)|out for delivery|\breceipt\b|your (cart|subscription|trip|flight|reservation|booking|package)|\bcheckout\b|transfer (#|to )|payment (received|confirmation))/i],
  ["noise:security", /(verification code|security code|one[- ]time (code|passcode)|password (reset|change|was changed|has been changed)|sign-?in (attempt|alert)|new (device|login))/i],
  ["noise:digest", /(view (this )?(email )?in (your )?browser|manage (your )?(email )?preferences|newsletter|weekly digest|daily digest|playlist)/i],
];

export function triage(email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">): TriageResult {
  if (PROTECT_SENDER.test(email.from)) return { pass: true, reason: "protected" };
  const text = `${email.subject}\n${email.bodyText.slice(0, 2500)}`;
  if (PROTECT_TEXT.test(text)) return { pass: true, reason: "protected" };
  for (const [reason, re] of NOISE) if (re.test(text)) return { pass: false, reason };
  return { pass: true, reason: "unclassified" };
}

/**
 * Gmail search that generates candidates. Semantic and recall-first: Gmail's own classifier already separates
 * Promotions, Social and Forums, so those are excluded and nothing is filtered on hiring words. The frozen keyword query
 * (subject words or applicant-tracking senders) never fetched about a quarter of the positives on the development
 * mailbox. Not wired into the product yet: that waits for a decision on how the model reader runs in production.
 */
export const CANDIDATE_QUERY_V2 = [
  "newer_than:365d",
  "-in:spam -in:trash -in:drafts -in:sent",
  "-category:promotions -category:social -category:forums",
].join(" ");
