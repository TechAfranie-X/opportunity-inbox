import { findDateMentions } from "../recruiting/dates.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { parseSender } from "../opportunities/normalize.ts";
import { resolveCompany } from "../recruiting/entity/resolve.ts";
import { classifySender } from "../recruiting/entity/vendors.ts";
import { NOT_AN_OFFER, NOT_AN_OFFER_FOR_YOU, OFFER_SUBJECT } from "../lifecycle/refine.ts";
import { NEAR_MISS } from "./flags.ts";

/**
 * Ingestion facts: polarity and date facts read from the message text AFTER the rule reader, where the body is still in memory (bodies are never stored).
 * Each fact only corrects what the reader got wrong from wording it cannot weigh; none invents an event. The frozen reader (lib/recruiting/extract.ts) is untouched.
 *
 *  cancellation   "your interview has been cancelled" is an update that ends a scheduled interview, never a scheduled interview. A reschedule is not a cancellation.
 *  deadline       an explicit absolute date next to a deadline cue ("The deadline is October 8", "was due on September 28") beats a relative window ("within 7 days")
 *                 and is recorded even when it has already passed (an overdue request is still the date that matters).
 *  non-recruiting generic assessment results sold with an upsell (a personality profile) are something any vendor sends anyone, not a candidacy.
 */
const SCHEDULED = new Set<string>(["interview_scheduled", "interview_invite"]);
const CANCELLED = /\b(?:interview|meeting|call|session|conversation|screen(?:ing)?)\b[^.!?\n]{0,80}\b(?:has|have|had|is|was|were|been|will be)\s+(?:been\s+)?(?:cancel(?:l)?ed|called off)\b|\b(?:cancel(?:l)?ed|cancel(?:l)?ing|cancel(?:l)?ation of)\b[^.!?\n]{0,50}\b(?:interview|meeting|call|session)\b|\bno longer (?:be )?(?:moving forward with|proceeding with|holding|scheduling) (?:the |your |an )?(?:upcoming )?interview\b/i;
const RESCHEDULED = /\breschedul(?:e|ed|ing)\b|\bnew (?:time|date|slot)\b|\bfind (?:a )?(?:new|another) time\b|\bpick (?:a )?(?:new|another) (?:time|date|slot)\b/i;

const DEADLINE_CUE = /\b(?:deadline(?: is| was)?|due (?:on|by|date)|due:|expires? (?:on)?|no later than|complete(?:d)? (?:it |this |the \w+ )?by|submit(?:ted)? (?:it )?by|must be (?:completed|submitted) by|(?:finish|complete|submit)[^.\n]{0,40}\bbefore)\b[^.\n]{0,25}$/i;
const RELATIVE = /\bwithin\s+\d+\s*(?:hours?|days?|weeks?)(?:\s+of\s+[^.,;\n]{0,40})?|\bin\s+\d+\s+days?\b/gi;
const DEADLINE_TYPES = new Set<string>(["assessment", "assessment_completed", "interview_invite", "recruiter_outreach", "offer", "follow_up", "status_update"]);

const GENERIC_RESULT = /\b(?:personality|disc\b|myers|strengths?finder|enneagram|career (?:profile|quiz)|aptitude (?:report|profile))\b/i;
const UPSELL = /\b(?:upgrade (?:to )?(?:the )?(?:pro|premium|full)|unlock (?:your )?full|\$\d{2,4}\b[^.\n]{0,40}(?:report|profile|unlock)|get your full report)\b/i;
const CANDIDACY = /\b(?:your application|the (?:role|position)|hiring (?:team|manager)|recruit(?:er|ing team)|next (?:steps|round)|interview)\b/i;

export function applyFacts(email: Pick<RecruitingEmail, "subject" | "bodyText" | "receivedAt">, event: ExtractedEvent): ExtractedEvent {
  const text = `${email.subject ?? ""}\n${email.bodyText ?? ""}`;
  let out = event;
  const set = (patch: Partial<ExtractedEvent>, signal: string) => { out = { ...out, ...patch, signals: [...out.signals, signal] }; };

  const stillOn = /\b(?:see you|is confirmed|are confirmed|has been confirmed|confirmed for|scheduled for|looking forward to (?:speaking|meeting|seeing))\b/i.test(text);
  if (SCHEDULED.has(out.type) && CANCELLED.test(text) && !RESCHEDULED.test(text) && !stillOn) {
    set({ type: "status_update", eventDate: null, eventDateHasTime: false, dateKind: null, fieldConfidence: { type: Math.max(out.fieldConfidence?.type ?? 0, 0.7), company: out.fieldConfidence?.company ?? out.confidence, role: out.fieldConfidence?.role ?? out.confidence } }, "cancellation (fact)");
  }

  if (DEADLINE_TYPES.has(out.type) && (out.type === "assessment" || out.type === "assessment_completed" || out.dateKind === "deadline" || out.eventDate === null)) {
    const absolute = text.replace(RELATIVE, " ");
    const hit = findDateMentions(absolute, email.receivedAt).find((m) => DEADLINE_CUE.test(absolute.slice(Math.max(0, m.index - 40), m.index)));
    if (hit && (!out.eventDate || out.eventDate.getTime() !== hit.date.getTime())) {
      set({ eventDate: hit.date, eventDateHasTime: hit.hasTime, dateKind: "deadline" }, "explicit deadline (fact)");
    }
  }

  if ((out.type === "assessment" || out.type === "assessment_completed") && GENERIC_RESULT.test(text) && UPSELL.test(text) && !CANDIDACY.test(text)) {
    set({ confidence: Math.min(out.confidence, 0.3), eventDate: null, dateKind: null, reviewReasons: [...(out.reviewReasons ?? []), "possible: a generic assessment result, not tied to an application"] }, NEAR_MISS);
  }
  return out;
}

const OFFER_ROLE = /\boffer you the (?:position|role|internship) of\s+([^\n.]{3,110}?)\s+(?:at|with)\s+[A-Z]/;

/**
 * Offer fact: a message the rule reader rejected ("no recruiting language") whose subject plainly congratulates the reader on a job offer, sent by an
 * employer or an applicant-tracking platform, and whose body says so too. Missing an offer is the costliest silent miss, so this is read from the text
 * while it is in memory; advice, scam and marketing wording is excluded by the same lists the refinement layer uses. Role is taken only from the
 * "offer you the position of ... at ..." sentence and left empty otherwise.
 */
export function explicitOffer(email: RecruitingEmail): ExtractedEvent | null {
  if (email.outbound) return null;
  const subject = email.subject.trim();
  if (!OFFER_SUBJECT.test(subject) || NOT_AN_OFFER.test(subject) || NOT_AN_OFFER_FOR_YOU.test(subject)) return null;
  if (!/\boffer\b/i.test(email.bodyText)) return null;
  const sender = parseSender(email.from);
  const kind = classifySender(sender.domain);
  if (kind !== "ats" && kind !== "employer") return null;
  const audit = resolveCompany({ from: email.from, replyTo: email.replyTo, subject, body: email.bodyText });
  const role = OFFER_ROLE.exec(email.bodyText)?.[1]?.trim() ?? null;
  const companyConf = Math.round(audit.confidence * 100) / 100;
  return {
    gmailMessageId: email.id,
    gmailThreadId: email.threadId,
    occurredAt: email.receivedAt,
    outbound: false,
    senderName: email.from.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim(),
    senderDomain: sender.domain,
    subject,
    type: "offer",
    company: audit.entity?.name ?? null,
    role,
    eventDate: null,
    eventDateHasTime: false,
    dateKind: null,
    confidence: 0.9,
    fieldConfidence: { type: 0.9, company: companyConf, role: role ? 0.8 : 0 },
    reviewReasons: audit.entity ? [] : ["company: the name could not be found in the email"],
    signals: ["offer (ingestion)", "subject"],
  };
}

/**
 * Body-act fact. General failure pattern: the rule reader needs hiring words in the SUBJECT or a platform sender, so a person at an employer who writes a plain
 * subject ("Next steps", "Quick update") and says the hiring act in the body is read as "no recruiting language" and never reaches the pipeline. This fact
 * reads a rejected message once more for one explicit act addressed to the reader, in the body only (never stored):
 *   offer        "we'd like to offer you the <role>", "pleased to extend an offer", "welcome to the team ... start date"
 *   invitation   "could you do a video interview", "we will move forward with scheduling a call", "schedule a first call"
 *   confirmed    "you're booked for Thursday", "rescheduled your interview to <date>"
 * Guards: not outbound, not a consumer-style sender list is unavailable so the act must sit next to hiring context (role, interview, application, cv,
 * portfolio, assessment, cohort, start date ...). Advice, scam and marketing wording is excluded by the offer lists. Marketing footers do not veto an act that names the
 * reader's own application, interview or assessment. The result is deliberately low-confidence and carries a review reason: it says what was read and why to check it.
 */
const HIRING_CONTEXT = /\b(?:role|position|internship|intern|job|interview|application|candidacy|assessment|cv|resume|r[eé]sum[eé]|portfolio|cohort|fellowship|scholarship|start date|onboarding|new[- ]grad)\b/i;
const YOUR_OWN = /\b(?:your (?:application|interview|assessment|cv|resume|r[eé]sum[eé]|portfolio|profile)|interview with)\b/i;
const MARKETING_FOOTER = /\b(?:unsubscribe|manage (?:your )?(?:email )?preferences|view (?:this )?(?:email )?in (?:your )?browser|you are receiving this)\b/i;
const ACT_OFFER = /\b(?:we(?:['’]d| would) like to offer you|we (?:are|['’]re) (?:pleased|happy|delighted|thrilled|excited) to (?:offer you|extend (?:you )?an? (?:formal |job )?offer)|pleased to extend (?:you )?an? (?:formal |job )?offer|offer you the [^.\n]{3,70}\b(?:role|position|internship))\b|\bwelcome to the team\b[^\n]{0,140}\b(?:start date|first day|onboarding)\b/i;
const ACT_INVITE = /\b(?:(?:could|can|would) you (?:do|join|make time for|schedule)[^.?\n]{0,50}\b(?:interview|call|chat|conversation)\b|(?:move|moving) forward with scheduling\b|(?:schedule|set up|arrange) (?:a |an )?(?:first |second |final |short |quick |\d+-min(?:ute)? )?(?:call|chat|interview|conversation)\b|(?:i|we)(?:['’]d| would) like to (?:invite you to|schedule) (?:an? )?(?:interview|call|chat))/i;
const ACT_CONFIRMED = /\b(?:you(?:['’]re| are) booked for|(?:i|we)(?:['’]ve| have) rescheduled your (?:interview|call)(?: to)?|your (?:interview|call) (?:is|has been) (?:set|booked|confirmed|scheduled)(?: for)?)\b/i;
const GREETING_WORD = /^\s*(?:hi|hello|hey|dear|good (?:morning|afternoon))\b/i;
const NAME_LEAD = /^\s*[A-Z][\p{L}'’-]+[,!]\s/u;
const GREETING = { test: (b: string) => GREETING_WORD.test(b) || NAME_LEAD.test(b) };

export function bodyAct(email: RecruitingEmail): ExtractedEvent | null {
  if (email.outbound) return null;
  const body = email.bodyText;
  const text = `${email.subject}\n${body}`;
  if (!HIRING_CONTEXT.test(text) || !GREETING.test(body)) return null;
  if (NOT_AN_OFFER.test(email.subject) || NOT_AN_OFFER_FOR_YOU.test(text)) return null;
  if (MARKETING_FOOTER.test(body) && !YOUR_OWN.test(text)) return null;
  let type: ExtractedEvent["type"] | null = null;
  if (ACT_OFFER.test(body)) type = "offer";
  else if (ACT_CONFIRMED.test(body)) type = "interview_scheduled";
  else if (ACT_INVITE.test(body)) type = "interview_invite";
  if (!type) return null;
  const sender = parseSender(email.from);
  const kind = classifySender(sender.domain);
  if (kind === "job_board") return null;
  const audit = resolveCompany({ from: email.from, replyTo: email.replyTo, subject: email.subject.trim(), body });
  const role = type === "offer" ? (OFFER_ROLE.exec(body)?.[1]?.trim() ?? null) : null;
  return {
    gmailMessageId: email.id,
    gmailThreadId: email.threadId,
    occurredAt: email.receivedAt,
    outbound: false,
    senderName: email.from.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim(),
    senderDomain: sender.domain,
    subject: email.subject.trim(),
    type,
    company: audit.entity?.name ?? null,
    role,
    eventDate: null,
    eventDateHasTime: false,
    dateKind: null,
    confidence: 0.6,
    fieldConfidence: { type: 0.6, company: Math.round(audit.confidence * 100) / 100, role: role ? 0.6 : 0 },
    reviewReasons: ["type: read from the wording of the message body only, please check it"],
    signals: ["body act (fact)"],
  };
}
