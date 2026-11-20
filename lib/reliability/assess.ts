import { parseSender } from "../opportunities/normalize.ts";
import { resolveCompany } from "../recruiting/entity/resolve.ts";
import { classifySender } from "../recruiting/entity/vendors.ts";
import { extractAll, extractWithReason, isContinuityCandidate, stripQuoted, type ReadContext } from "../recruiting/extract.ts";
import { processEvidence } from "../recruiting/signals.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { applyFacts, bodyAct, explicitOffer } from "./facts.ts";
import { CONFLICT_PREFIX, MEMBERSHIP_PREFIX, NEAR_MISS, NEAR_MISS_WEAK, hasDoubt, isNearMiss } from "./flags.ts";
import { studentAcceptance } from "./facts.ts";
import { closureFact, marketingFact } from "./evidence.ts";
import { employerProvenance, groundingOf, isLinkedEvent } from "./grounding.ts";

/**
 * The reliability layer around the rule reader. The reader is unchanged; this layer only checks and abstains:
 *
 *  1. Grounding: a company or role that cannot be traced to the message (or the message it was linked to) is dropped to unknown and
 *     sent to review, never shown as fact.
 *  2. Weak membership: the reader's type confidence says what kind of message it is, not WHETHER it belongs to the reader's hiring
 *     process (its false positives are as confident as its true positives). Two independent weak signals decide doubt: the message
 *     names no application or interview of the reader's, and Gmail's own importance model did not mark it important. Doubt is
 *     visible (review) and quiet (no urgent action). It is never a verdict.
 *  3. Near misses: the reader's silent misses are invisible by definition. A rejected message that still names a candidacy, is Gmail-
 *     important and is not bulk mail is surfaced for a human look as "possibly recruiting", without entering the pipeline.
 *
 * Every rule here is a structural property of mail, not a phrasing taken from a dataset. Absent evidence is never treated as
 * negative: a message with no Gmail labels (an old row, the sample mailbox) gets no membership judgement.
 */
export { NEAR_MISS, NEAR_MISS_WEAK, MEMBERSHIP_PREFIX, CONFLICT_PREFIX, isNearMiss, hasDoubt };

const BULK = /\b(?:unsubscribe|manage (?:your )?(?:email )?preferences|view (?:this )?(?:email )?in (?:your )?browser|email preferences|opt[- ]out|you are receiving this|sent to you because)\b/i;
const IMPORTANT = "IMPORTANT";

/** The sender is hiring infrastructure: a known applicant-tracking platform, or a careers/jobs/recruiting/talent/hr mailbox. */
function hiringSender(from: string): boolean {
  const addr = /<?([^<>\s@]+)@([^<>\s]+)>?/.exec(from);
  if (!addr) return false;
  return classifySender(addr[2].toLowerCase()) === "ats" || HIRING_MAILBOX.test(addr[1]);
}
const RECEIPT = /\b(?:thank(?:s| you) for (?:applying|your application|submitting your|completing)|we(?:'ve| have) (?:successfully )?received your (?:application|candidacy|submission)|your application (?:to|for|with|at|has been|was|is) [^.\n]{0,70}\b(?:received|submitted|sent|complete|in)\b|application (?:received|confirmation|submitted|complete)\b|you(?:'ve| have) (?:successfully )?applied|(?:assessment|coding challenge|online test|pre-screen) (?:completed|submitted|received)\b|thank(?:s| you) for (?:taking|completing) (?:the |our |your )?[\w -]{0,40}(?:assessment|challenge|test))/i;
export function membershipDoubt(email: RecruitingEmail, event: ExtractedEvent): string | null {
  if (email.outbound || isLinkedEvent(event)) return null; // linked to a candidacy we already know by its thread or sender
  const evidence = processEvidence(email.subject, email.bodyText);
  // Course, event and promotion vocabulary with nothing about a job: "application" and "next steps" are shared with enrolments and prizes.
  if (evidence.eventLike && !evidence.employment) return `${MEMBERSHIP_PREFIX} it reads like a course, event or promotion rather than a job`;
  if (!email.labels || email.labels.length === 0) return null; // no Gmail signal is not evidence against
  if (evidence.candidacy || email.labels.includes(IMPORTANT)) return null;
  // an explicit receipt of the reader's own action ("Thank you for applying to X", "We have received your application", "Assessment completed: X") IS a named candidacy
  // ... when it also comes from hiring infrastructure (an applicant-tracking platform, a careers/jobs/talent mailbox) or speaks of employment: a gym's or a club's receipt is still doubted
  if ((RECEIPT.test(email.subject) || RECEIPT.test(email.bodyText.slice(0, 700))) && (evidence.employment || hiringSender(email.from))) return null;
  return `${MEMBERSHIP_PREFIX} nothing in it names one of your applications or interviews, and Gmail did not mark it important`;
}

/**
 * Farewell language: a closing wish about the reader's SEARCH or FUTURE ("best of luck with your search", "we wish you success in
 * your future endeavours"), or the stock phrases of a decision ("other candidates", "not a fit", "keep your resume on file").
 * Rejections end this way even when the wording of the decision itself is unfamiliar. Pleasantries about something upcoming
 * ("good luck on the assessment") do not match: the wish must be about the search or the future.
 */
const FORWARD = /\b(?:invit(?:e|ed|ation) (?:you )?to (?:complete|take|schedule|interview|join|begin|start)|first (?:step|round|stage)|next (?:step|round|stage)s?|(?:complete|finish|submit|take) (?:it |this |the |your )?(?:[\w-]+ ){0,3}(?:within|by|before) |within \d+ (?:days?|hours?)|successful candidates?|candidates? who (?:pass|succeed|progress|complete)|progress to (?:the |an? )?(?:next|interview|final)|(?:start|begin) (?:the |your )?(?:assessment|challenge|exercise|test))\b/i;
const FAREWELL = [
  /\b(?:best of luck|wish you (?:all )?(?:the best|success|luck)|good luck)\b[^.\n]{0,40}\b(?:search|future|endeavou?rs|career|journey)\b/i,
  /\bfuture (?:endeavou?rs|opportunities)\b/i,
  /\b(?:other|another) (?:candidates?|applicants?)\b/i,
  /\b(?:not|isn't|aren't) (?:a |the )?(?:right |good |strong )?(?:fit|match)\b/i,
  /\b(?:keep|retain) (?:your )?(?:resume|resum\u00e9|cv|information|details) (?:on file|for future)\b/i,
];

/** The message says goodbye, but the event was typed as something that keeps the opportunity alive. */
export function outcomeConflict(email: RecruitingEmail, event: ExtractedEvent): string | null {
  if (email.outbound || ["rejection", "offer", "withdrawn", "user_reply"].includes(event.type)) return null;
  const text = stripQuoted(email.bodyText);
  if (!FAREWELL.some((r) => r.test(text))) return null;
  // A message that INVITES the reader to do something next (a first step, an assessment to complete within days, "successful candidates may progress") and says nothing that closes
  // the candidacy is not a goodbye: "other candidates" and "not a fit" there describe the process, not the reader's outcome. Explicit closure wording still keeps the doubt.
  if (FORWARD.test(text) && !closureFact(email)) return null;
  return `${CONFLICT_PREFIX} the wording reads like a goodbye, but it was read as "${event.type.replace(/_/g, " ")}"`;
}

const ONBOARDING = /\b(?:i-?9|background (?:check|verification|screening)|start date|first day|onboarding|new hire|eligibility to work)\b/i;
/** Role mailboxes that are how hiring mail is actually sent (careers@, talent@, people@). Marketing mailboxes (news@, events@, info@) are not among them. */
const HIRING_MAILBOX = /^(?:careers?|jobs?|recruit\w*|talent|hr|people|hiring|staffing)\b/i;

/**
 * A message the reader rejected, or could not read, that structurally looks like part of a hiring process. Two tiers:
 *  - strong: Gmail marked it important, it names one of the reader's applications or interviews, and it is not bulk mail;
 *    or it could not be read at all. Counted in the review badge.
 *  - weak: it is about a job or onboarding and comes from a named person or hiring mailbox at an employer (and Gmail marked it
 *    important), or from an applicant-tracking platform. Offered in a folded list, never counted.
 * On development data the strong tier costs about 6 review items per 1,000 messages read and the weak tier about 13 more.
 */
export function nearMiss(email: RecruitingEmail): ExtractedEvent | null {
  if (email.outbound) return null;
  const important = email.labels?.includes(IMPORTANT) ?? false;
  const sender = parseSender(email.from);
  const kind = classifySender(sender.domain);
  const platform = kind === "ats" || kind === "assessment";
  const evidence = processEvidence(email.subject, email.bodyText);
  const bulk = BULK.test(email.bodyText);
  const about = evidence.employment || ONBOARDING.test(`${email.subject}\n${email.bodyText}`);
  const person = isContinuityCandidate(email) || (kind === "employer" && HIRING_MAILBOX.test(sender.localPart));

  const unreadable = email.bodyUnreadable === true && (important || platform); // cannot be judged by its text at all
  const strong = important && evidence.candidacy && !bulk;
  const weak = (important && about && !bulk && (person || platform)) || (platform && evidence.employment && !bulk);
  if (!unreadable && !strong && !weak) return null;
  return candidateEvent(email, unreadable || strong ? "strong" : "weak", unreadable ? "possible: we could not read the text of this email" : "possible: this looks like part of a hiring process but we did not recognise what it says");
}

/**
 * The event form of "possibly recruiting": not a recruiting decision, never in the pipeline until a person says so. Shared by the structural
 * near-miss criteria above and by the second-reader consensus (lib/semantic/consensus.ts). Company comes from the deterministic resolver only.
 */
export function candidateEvent(email: RecruitingEmail, tier: "strong" | "weak", reason: string, extraSignals: string[] = []): ExtractedEvent {
  const sender = parseSender(email.from);
  const rejected = extractWithReason(email).reason ?? "no_recruiting_signal";
  const audit = resolveCompany({ from: email.from, replyTo: email.replyTo, subject: email.subject.trim(), body: email.bodyText });
  return {
    gmailMessageId: email.id,
    gmailThreadId: email.threadId,
    occurredAt: email.receivedAt,
    outbound: false,
    senderName: email.from.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim(),
    senderDomain: sender.domain,
    subject: email.subject.trim(),
    type: "status_update",
    company: audit.entity?.name ?? null,
    role: null,
    eventDate: null,
    eventDateHasTime: false,
    dateKind: null,
    confidence: 0.3,
    fieldConfidence: { type: 0.2, company: Math.round(audit.confidence * 100) / 100, role: 0 },
    reviewReasons: [reason],
    signals: [NEAR_MISS, ...(tier === "weak" ? [NEAR_MISS_WEAK] : []), ...extraSignals, `rejected:${rejected}`],
  };
}

/** The product's reader: the rule reader, then grounding, weak-membership doubt and near misses. */
export function readMail(emails: RecruitingEmail[], context?: ReadContext): ExtractedEvent[] {
  const byId = new Map(emails.map((e) => [e.id, e]));
  const events = extractAll(emails, context).map((event) => {
    const email = byId.get(event.gmailMessageId);
    if (email?.outbound) return studentAcceptance(email, event);
    if (!email) return event;
    const out: ExtractedEvent = { ...event, signals: [...event.signals], reviewReasons: [...(event.reviewReasons ?? [])] };
    const g = groundingOf(email, out);
    if (!g.company) {
      out.company = null;
      out.fieldConfidence = { type: out.fieldConfidence?.type ?? out.confidence, company: 0, role: out.fieldConfidence?.role ?? 0 };
      out.reviewReasons!.push("company: the name could not be found in the email");
      out.signals.push("grounding:company-dropped");
    }
    if (!g.role) {
      out.role = null;
      out.fieldConfidence = { type: out.fieldConfidence?.type ?? out.confidence, company: out.fieldConfidence?.company ?? out.confidence, role: 0 };
      out.signals.push("grounding:role-dropped");
    }
    Object.assign(out, employerProvenance(email, out));
    const doubt = membershipDoubt(email, out);
    if (doubt) out.reviewReasons!.push(doubt);
    const conflict = outcomeConflict(email, out);
    if (conflict) out.reviewReasons!.push(conflict);
    return applyFacts(email, out); // polarity and explicit-date facts from the text (lib/reliability/facts.ts)
  });
  const have = new Set(events.map((e) => e.gmailMessageId));
  const near = emails.flatMap((e) => (have.has(e.id) ? [] : [explicitOffer(e) ?? bodyAct(e) ?? nearMiss(e)].filter((x): x is ExtractedEvent => x !== null)));
  const flagged = near.map((e) => { const m = byId.get(e.gmailMessageId); const k = m && !m.outbound ? marketingFact(m) : null; return k ? { ...e, signals: [...e.signals, `marketing:${k}`] } : e; });
  return [...events, ...flagged].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
