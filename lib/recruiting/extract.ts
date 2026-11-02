import { parseSender, stripSubjectAnnotations } from "../opportunities/normalize.ts";
import { inferCompany, inferRole } from "./company.ts";
import { pickDate } from "./dates.ts";
import type { EventType, ExtractedEvent, RecruitingEmail } from "./types.ts";

/**
 * Deterministic email -> structured event extraction.
 *
 * Why rules and not an LLM: it is free, private (nothing leaves the server),
 * deterministic, and unit-testable. The `signals` array records *why* we chose
 * a type so errors are debuggable. If rule accuracy plateaus during validation,
 * an LLM pass can slot in behind the same `ExtractedEvent` contract.
 */

type Rule = {
  type: EventType;
  signal: string;
  pattern: RegExp;
  /** Ends or advances the process: only trusted when stated unconditionally. */
  terminal?: boolean;
  /** Low-information type: yields to any stronger evidence. */
  weak?: boolean;
  /** Only meaningful in the subject (never matched against the body). */
  subjectOnly?: boolean;
};

// Order = priority within each tier.
export const RULES: Rule[] = [
  { type: "rejection", signal: "rejection", terminal: true,
    pattern: /\b(?:not (?:be )?(?:moving|proceeding|going) forward|will not be (?:moving|proceeding)|regret to inform|decided to (?:move|go|proceed|progress|pursue) (?:forward )?with (?:other|another)|(?:pursue|progress with|moving forward with) (?:other|another) (?:candidates?|applicants?)|we (?:have )?filled this role|position has been filled|not (?:been )?selected for|you (?:were|are|have been) not selected|unable to (?:offer you|move (?:you )?forward)|won't be able to move you forward|not able to move forward)\b/i },
  { type: "offer", signal: "offer", terminal: true,
    pattern: /\b(?:pleased to (?:extend|offer)|(?:extend|extending) (?:you )?(?:an? |the )?offer|offer letter|offer of employment|formal offer|excited to offer you|your (?:\w+ )?offer (?:is ready|letter|is attached|has been)|next steps for your (?:\w+ )?offer)\b/i },
  // Nudges about an unfinished application. Strong, so a keyword in the body can't re-type them.
  { type: "follow_up", signal: "unfinished application reminder", subjectOnly: true,
    pattern: /\b(?:incomplete application|application (?:is )?due|due date|still have an application|(?:finish|complete) your [\w ]{0,30}application|final step to complete|days? left to|reminder:? .{0,60}application)\b/i },
  { type: "status_update", signal: "platform confirmation",
    pattern: /\b(?:interview )?availability (?:was )?submitted\b|\byou(?:'|’)?re moving forward\b/i },
  { type: "assessment_completed", signal: "assessment received",
    pattern: /\b(?:thank(?:s| you) for (?:completing|submitting your (?:assessment|solution))|we(?:'ve| have) received your (?:assessment|submission|solution)|assessment (?:complete|completed|received|submitted|results|submission)|results? for .{0,60}(?:assessment|pre-?screen) (?:is|are) now available)\b/i },
  { type: "assessment", signal: "assessment",
    pattern: /\b(?:online assessment|coding assessment|technical assessment|coding challenge|take-?home|invited (?:you )?to (?:complete|take) (?:an? |the )?(?:online )?(?:assessment|challenge|test)|complete (?:the|your|an?) (?:\w+ ){0,2}(?:assessment|challenge)|assessment (?:invitation|link)|(?:hackerrank|codesignal|codility|coderpad) (?:assessment|test|challenge|link)|waiting for your .{0,40}assessment|(?:request|assessment|invitation) (?:from .{1,40} )?(?:has )?expired)\b/i },
  { type: "interview_scheduled", signal: "interview confirmed",
    pattern: /\b(?:interview (?:is )?(?:confirmed|scheduled)|confirm(?:ing|ation of)? your (?:upcoming )?interview|your (?:upcoming )?interview (?:on|is|will)|\b(?:upcoming|final|technical|virtual|onsite|on-site|panel) interview\b|(?:externship|internship) interview\b|invitation[^:]{0,40}:.{0,80}interview|reminder\W+(?!to schedule).{0,20}interview|interview confirmation|interview schedule|you(?:'re| are) (?:all set|scheduled) for)\b/i },
  { type: "interview_invite", signal: "interview invite",
    pattern: /\b(?:schedule (?:your |an? |the )?(?:interview|call|conversation|time|chat)|(?:invite|like to invite) you (?:to|for) (?:an? |the )?(?:\w+ )?interview|like to interview you|interview invitation|invitation to (?:an? )?interview|invited to interview|reminder to schedule|select (?:a |your )?(?:time|slot)|(?:share|send) (?:me )?your availability|book (?:a )?(?:time|slot)|pick a time)\b/i },
  { type: "recruiter_outreach", signal: "recruiter outreach",
    pattern: /\b(?:i(?:'m| am) (?:a |the )?(?:recruiter|sourcer|talent)|reaching out (?:to you )?(?:about|regarding|because)|came across your (?:profile|resume|background|application)|your (?:background|profile) (?:caught|stood|looks)|chat about (?:an? |the )?(?:opportunity|role|position)|quick (?:call|chat)|recruiter screen|phone screen|intro call)\b/i },
  { type: "applied", signal: "application confirmation", weak: true,
    pattern: /\b(?:thank(?:s| you)\W+(?:\w+\W+){0,2}for (?:applying|your (?:application|interest)|submitting)|(?:we(?:'ve| have) )?received your (?:job )?application|application (?:has been )?(?:received|submitted)|successfully (?:submitted|applied)|you have (?:successfully )?applied|your application (?:to|for|at|with) )\b/i },
  { type: "follow_up", signal: "follow up", weak: true,
    pattern: /\b(?:following up|follow-up|checking in|just checking|any updates?|touching base|(?:finish|complete) your (?:job )?application|final step to complete|days? left to)\b/i },
  { type: "status_update", signal: "generic update", weak: true, subjectOnly: true,
    pattern: /\b(?:application|candidacy|candidate) (?:update|status)|update (?:on|to) your|an update on|important information about your application|update regarding your|your (?:recent )?(?:job )?application status|your interest in|follow(?:ing)? up (?:on|to) your/i },
];

/** Drop quoted history so a reply doesn't inherit the thread's earlier "offer"/"rejection". */
export function stripQuoted(body: string) {
  const cut = body.search(
    /\n\s*On .{8,140}wrote:|\n\s*-{2,}\s*Original Message|\n\s*From:\s.+\n\s*(?:Sent|Date):|\n\s*_{8,}/i,
  );
  const head = cut >= 0 ? body.slice(0, cut) : body;
  return head.split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
}

/** Wording that makes a sentence hypothetical, so it must not decide the event type. */
export const CONDITIONAL =
  /\b(?:if|should|in case|in the event|unless|whether|either|candidates who|those who|that means|may be|might|could be|will be contacted|you may be asked|are selected|is selected|when you)\b/i;

/** First rule (in `candidates` order) with an *unconditional* sentence match in the body. */
function bodyMatch(candidates: Rule[], body: string): Rule | undefined {
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  return candidates.find((rule) =>
    !rule.subjectOnly && sentences.some((sentence) => rule.pattern.test(sentence) && !CONDITIONAL.test(sentence)),
  );
}

type Detected = { type: EventType; signal: string; inSubject: boolean };

/**
 * Tiered evidence, strongest first:
 *  1. specific type named in the subject
 *  2. unconditional terminal language in the body (rejection / offer)
 *  3. unconditional advancing language in the body (assessment, interview, outreach)
 *  4. weak subject (applied / follow-up / generic update)
 *  5. weak body (applied / follow-up)
 * Generic update emails with no supporting content resolve to `status_update`,
 * never to a terminal state we cannot justify.
 */
function detectType(subject: string, rawBody: string): Detected | null {
  const body = stripQuoted(rawBody).slice(0, 3000);
  const strong = RULES.filter((r) => !r.weak);
  const weak = RULES.filter((r) => r.weak);
  const hit = (rule: Rule, inSubject: boolean): Detected => ({ type: rule.type, signal: rule.signal, inSubject });

  const subjectStrong = strong.find((r) => r.pattern.test(subject));
  if (subjectStrong) return hit(subjectStrong, true);

  const terminal = bodyMatch(strong.filter((r) => r.terminal), body);
  if (terminal) return hit(terminal, false);

  const advancing = bodyMatch(strong.filter((r) => !r.terminal), body);
  if (advancing) return hit(advancing, false);

  const subjectWeak = weak.find((r) => r.pattern.test(subject));
  if (subjectWeak) return hit(subjectWeak, true);

  const bodyWeak = bodyMatch(weak, body);
  return bodyWeak ? hit(bodyWeak, false) : null;
}

/** Verification / login codes are transactional noise, never recruiting activity. */
const TRANSACTIONAL_SUBJECT =
  /\b(?:security|verification|confirmation|one[- ]time|login|sign[- ]in|access) (?:pass)?code\b|\bverify your (?:email|account|identity)\b|\bpassword reset\b|\breset your password\b/i;

/** Promotions that borrow recruiting vocabulary ("applications are now open", "free offer"). */
const MARKETING_SUBJECT =
  /\bapplications? (?:are )?(?:now )?open\b|\bnow open\b|\bapply (?:today|now|by|before)\b|\blast call\b|\bdon'?t miss\b|\blimited[- ]time\b|\bregister (?:now|today)\b|\bwebinar\b|\bcareer fair\b|\bsave the date\b|\bfree offer\b|\d+% off\b|\bon sale\b|\bis (?:still )?open\b|\bjob matches\b|\bget ready for\b|\bboost your\b|\binfo(?:rmation)? session\b|\bworkshop\b|\bthanks to\b|\bfree\b/i;

/** Types a promotion can fake. Rejections, confirmed interviews and assessment receipts are never promotional. */
const MARKETING_FAKEABLE = new Set<EventType>(["interview_scheduled", "applied", "follow_up", "status_update", "recruiter_outreach", "interview_invite", "assessment", "offer"]);

const AUTO_REPLY = /^\s*(?:automatic reply|auto-?reply|out of office|undeliverable)\b/i;
const WITHDRAW = /\b(?:withdraw(?:ing)? (?:my|from)|please withdraw|no longer (?:interested|available))\b/i;

const SCHEDULE_TYPES: EventType[] = ["interview_scheduled"];
const DEADLINE_TYPES: EventType[] = ["assessment", "offer", "interview_invite", "recruiter_outreach"];

/**
 * Extract a structured event from one *inbound* email, or null if it isn't
 * recruiting activity. Outbound mail is handled by `extractAll`.
 */
export function extractEvent(email: RecruitingEmail): ExtractedEvent | null {
  if (AUTO_REPLY.test(email.subject)) return null; // out-of-office / bounce notices are never recruiting events
  const sender = parseSender(email.from);
  const subject = email.subject.trim();
  if (TRANSACTIONAL_SUBJECT.test(subject)) return null;
  const normalizedSubject = stripSubjectAnnotations(subject);


  const bodyText = stripQuoted(email.bodyText);
  // A reply's subject is inherited thread history, so only its new text can type it.
  const isReply = /^\s*(?:re|fwd?)\s*:/i.test(subject);
  const detected = detectType(isReply ? "" : normalizedSubject, bodyText);
  if (!detected) return null;
  if (MARKETING_FAKEABLE.has(detected.type) && MARKETING_SUBJECT.test(subject)) return null;

  // "offer"/"next steps" words are common in marketing; require some recruiting context.
  if (
    (detected.type === "offer" || detected.type === "interview_invite" || detected.type === "follow_up") &&
    !/\b(?:applica|candidate|interview|role|position|intern|recruit|team|hiring|career|job)\w*/i.test(`${subject} ${bodyText.slice(0, 1500)}`)
  ) {
    return null;
  }

  const company = inferCompany({ from: email.from, subject, body: bodyText });
  let role = inferRole(subject, bodyText, company);
  if (role && company && role.toLowerCase().startsWith(`${company.toLowerCase()} `)) {
    role = role.slice(company.length + 1); // "Datadog Backend Engineer" -> "Backend Engineer"
  }

  let eventDate: Date | null = null;
  let eventDateHasTime = false;
  let dateKind: ExtractedEvent["dateKind"] = null;
  if (SCHEDULE_TYPES.includes(detected.type)) {
    const picked = pickDate(`${subject}\n${bodyText.slice(0, 3000)}`, email.receivedAt, "scheduled");
    if (picked) { eventDate = picked.date; eventDateHasTime = picked.hasTime; dateKind = "scheduled"; }
  } else if (DEADLINE_TYPES.includes(detected.type)) {
    const picked = pickDate(`${subject}\n${bodyText.slice(0, 3000)}`, email.receivedAt, "deadline");
    // Only trust dates for these types when a deadline cue sits nearby (pickDate falls back loosely).
    if (picked && detected.type !== "recruiter_outreach" && detected.type !== "interview_invite") {
      eventDate = picked.date; eventDateHasTime = picked.hasTime; dateKind = "deadline";
    }
  }

  // "Your request has expired" is itself the deadline: it lets Today stop nagging about it.
  if (detected.type === "assessment" && !eventDate && /\bexpired\b/i.test(`${subject}\n${bodyText.slice(0, 600)}`)) {
    eventDate = new Date(Date.UTC(email.receivedAt.getUTCFullYear(), email.receivedAt.getUTCMonth(), email.receivedAt.getUTCDate()));
    dateKind = "deadline";
  }

  let confidence = detected.inSubject ? 0.9 : 0.7;
  if (!company) confidence -= 0.3;
  if (sender.domain.length === 0) confidence -= 0.1;

  return {
    gmailMessageId: email.id,
    gmailThreadId: email.threadId,
    occurredAt: email.receivedAt,
    outbound: false,
    senderName: email.from.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim(),
    senderDomain: sender.domain,
    subject,
    type: detected.type,
    company,
    role,
    eventDate,
    eventDateHasTime,
    dateKind,
    confidence: Math.max(0.2, Math.round(confidence * 100) / 100),
    signals: [detected.signal, detected.inSubject ? "subject" : "body"],
  };
}

/**
 * Extract events from a batch. Outbound (sent) mail is only kept when it sits in
 * a thread that already has an inbound recruiting event — that is how we learn
 * the user replied, without ingesting the rest of their sent mail.
 */
export function extractAll(emails: RecruitingEmail[]): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const byThread = new Map<string, ExtractedEvent>();

  const unmatched: RecruitingEmail[] = [];
  for (const email of emails.filter((e) => !e.outbound)) {
    const event = extractEvent(email);
    if (!event) {
      unmatched.push(email);
      continue;
    }
    events.push(event);
    const existing = byThread.get(event.gmailThreadId);
    if (!existing || (!existing.company && event.company)) byThread.set(event.gmailThreadId, event);
  }

  // A reply inside a thread we already know is recruiting activity even when its own
  // text carries no keywords ("sounds good, see you then"). Keep it as a neutral
  // update so the timeline is complete, but skip auto-replies.
  for (const email of unmatched) {
    const anchor = byThread.get(email.threadId);
    if (!anchor || AUTO_REPLY.test(email.subject)) continue;
    const sender = parseSender(email.from);
    events.push({
      gmailMessageId: email.id,
      gmailThreadId: email.threadId,
      occurredAt: email.receivedAt,
      outbound: false,
      senderName: email.from.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim(),
      senderDomain: sender.domain,
      subject: email.subject.trim(),
      type: "status_update",
      company: anchor.company,
      role: anchor.role,
      eventDate: null,
      eventDateHasTime: false,
      dateKind: null,
      confidence: 0.6,
      signals: ["reply-in-recruiting-thread"],
    });
  }

  for (const email of emails.filter((e) => e.outbound)) {
    const anchor = byThread.get(email.threadId);
    if (!anchor) continue;
    const withdrawn = WITHDRAW.test(`${email.subject} ${email.bodyText.slice(0, 1000)}`);
    const followUp = RULES.find((r) => r.type === "follow_up")!.pattern.test(`${email.subject} ${email.bodyText.slice(0, 600)}`);
    events.push({
      gmailMessageId: email.id,
      gmailThreadId: email.threadId,
      occurredAt: email.receivedAt,
      outbound: true,
      senderName: "You",
      senderDomain: "",
      subject: email.subject.trim(),
      type: withdrawn ? "withdrawn" : followUp ? "follow_up" : "user_reply",
      company: anchor.company,
      role: anchor.role,
      eventDate: null,
      eventDateHasTime: false,
      dateKind: null,
      confidence: 0.9,
      signals: ["outbound-in-recruiting-thread"],
    });
  }

  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
