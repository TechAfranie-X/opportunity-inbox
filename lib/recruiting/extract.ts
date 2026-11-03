import { parseSender, stripSubjectAnnotations } from "../opportunities/normalize.ts";
import { inferRole } from "./company.ts";
import { classifySender } from "./entity/vendors.ts";
import { resolveBatch, resolveCompany, type CompanyResolution } from "./entity/resolve.ts";
import { CONDITIONAL, isAutoReply, isNegativeOutcome, processEvidence } from "./signals.ts";
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
  /** Structural test used alongside the phrase list, so one wording is not the only way to say it. */
  extra?: (sentence: string) => boolean;
};

const ruleMatches = (rule: Rule, text: string) => rule.pattern.test(text) || (rule.extra?.(text) ?? false);

// Order = priority within each tier.
export const RULES: Rule[] = [
  { type: "rejection", signal: "rejection", terminal: true, extra: isNegativeOutcome,
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
    pattern: /\b(?:i(?:'m| am) (?:a |the )?(?:recruiter|sourcer|talent)|reaching out (?:to you )?(?:about|regarding|because)|came across your (?:profile|resume|background|application)|your (?:background|profile) (?:caught|stood|looks)|chat about (?:an? |the )?(?:opportunity|role|position)|quick (?:call|chat)|recruiter screen|phone screen|intro call|(?:contact|recruiter|representative|employer|someone) (?:from .{1,70}? )?(?:has|have) reached out|job listing[^.\n]{0,60}application deadline)\b/i },
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

/** First rule (in `candidates` order) with an *unconditional* sentence match in the body. */
function bodyMatch(candidates: Rule[], body: string): Rule | undefined {
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  return candidates.find((rule) =>
    !rule.subjectOnly && sentences.some((sentence) => ruleMatches(rule, sentence) && !CONDITIONAL.test(sentence)),
  );
}

type Detected = { type: EventType; signal: string; inSubject: boolean; /** How trustworthy the tier that matched is, 0..1. */ strength: number };

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
  const hit = (rule: Rule, inSubject: boolean, strength: number): Detected => ({ type: rule.type, signal: rule.signal, inSubject, strength });

  const subjectStrong = strong.find((r) => ruleMatches(r, subject));
  if (subjectStrong) return hit(subjectStrong, true, 0.9);

  const terminal = bodyMatch(strong.filter((r) => r.terminal), body);
  if (terminal) return hit(terminal, false, 0.75);

  const advancing = bodyMatch(strong.filter((r) => !r.terminal), body);
  if (advancing) return hit(advancing, false, 0.7);

  const subjectWeak = weak.find((r) => ruleMatches(r, subject));
  if (subjectWeak) return hit(subjectWeak, true, 0.55);

  const bodyWeak = bodyMatch(weak, body);
  return bodyWeak ? hit(bodyWeak, false, 0.5) : null;
}

/** Verification / login codes are transactional noise, never recruiting activity. */
const TRANSACTIONAL_SUBJECT =
  /\b(?:security|verification|confirmation|one[- ]time|login|sign[- ]in|access) (?:pass)?code\b|\bverify your (?:email|account|identity)\b|\bpassword reset\b|\breset your password\b/i;

/** Promotions that borrow recruiting vocabulary ("applications are now open", "free offer"). */
const MARKETING_SUBJECT =
  /\bapplications? (?:are )?(?:now )?open\b|\bnow open\b|\bapply (?:today|now|by|before)\b|\blast call\b|\bdon'?t miss\b|\blimited[- ]time\b|\bregister (?:now|today)\b|\bwebinar\b|\bcareer fair\b|\bsave the date\b|\bfree offer\b|\d+% off\b|\bon sale\b|\bis (?:still )?open\b|\bjob matches\b|\bget ready for\b|\bboost your\b|\binfo(?:rmation)? session\b|\bworkshop\b|\bthanks to\b|\bfree\b/i;

/** Types a promotion can fake. Rejections, confirmed interviews and assessment receipts are never promotional. */
const MARKETING_FAKEABLE = new Set<EventType>(["interview_scheduled", "applied", "follow_up", "status_update", "recruiter_outreach", "interview_invite", "assessment", "offer"]);

const WITHDRAW = /\b(?:withdraw(?:ing)? (?:my|from)|please withdraw|no longer (?:interested|available))\b/i;

const SCHEDULE_TYPES: EventType[] = ["interview_scheduled"];
const DEADLINE_TYPES: EventType[] = ["assessment", "offer", "interview_invite", "recruiter_outreach"];

/** Types whose phrasing is shared with non-hiring mail: they need evidence of a hiring process (see signals.ts). */
const NEEDS_PROCESS = new Set<EventType>(["applied", "follow_up", "status_update", "recruiter_outreach", "interview_invite", "offer"]);
/** Types an event registration, course promotion or marketplace message can imitate. Rejections, scheduled interviews and assessments cannot be faked this way. */
const EVENT_FAKEABLE = new Set<EventType>(["applied", "follow_up", "status_update", "recruiter_outreach", "interview_invite"]);

/** Why an email was not treated as recruiting activity. Recorded so negatives are explainable, not just absent. */
export type RejectionReason = "auto_reply" | "transactional" | "no_recruiting_language" | "marketing" | "no_recruiting_context" | "non_hiring_event";

type Classified =
  | { reject: RejectionReason }
  | { reject: null; detected: Detected; subject: string; bodyText: string };

/**
 * Stage 1, per message: is this recruiting activity, and of what type? Everything here depends on the message alone.
 * Stage 2 (company, role, dates) builds on it; the company stage is the only one that benefits from seeing the batch.
 */
function classify(email: RecruitingEmail): Classified {
  const subject = email.subject.trim();
  const bodyText = stripQuoted(email.bodyText);
  if (isAutoReply(subject, bodyText)) return { reject: "auto_reply" }; // a machine answering for a person: context, never a lifecycle event
  if (TRANSACTIONAL_SUBJECT.test(subject)) return { reject: "transactional" };
  const normalizedSubject = stripSubjectAnnotations(subject);

  // A reply's subject is inherited thread history, so only its new text can type it.
  const isReply = /^\s*(?:re|fwd?)\s*:/i.test(subject);
  const detected = detectType(isReply ? "" : normalizedSubject, bodyText);
  if (!detected) return { reject: "no_recruiting_language" };
  if (MARKETING_FAKEABLE.has(detected.type) && MARKETING_SUBJECT.test(subject)) return { reject: "marketing" };

  // Shared vocabulary needs a hiring process behind it. An event/course/promotion with no candidacy attached is not one.
  const process = processEvidence(subject, bodyText);
  if (EVENT_FAKEABLE.has(detected.type) && process.eventLike && !process.candidacy) return { reject: "non_hiring_event" };
  if (NEEDS_PROCESS.has(detected.type) && !process.anchored) return { reject: "no_recruiting_context" };
  return { reject: null, detected, subject, bodyText };
}

/** Extract a structured event from one *inbound* email, or null if it isn't recruiting activity. Outbound mail is handled by `extractAll`. */
export function extractEvent(email: RecruitingEmail): ExtractedEvent | null {
  return extractWithReason(email).event;
}

export type Extraction = { event: ExtractedEvent; reason: null } | { event: null; reason: RejectionReason };

export function extractWithReason(email: RecruitingEmail, resolution?: CompanyResolution): Extraction {
  const c = classify(email);
  if (c.reject) return { event: null, reason: c.reject };
  return { event: buildEvent(email, c.detected, c.subject, c.bodyText, resolution), reason: null };
}

/** Stage 2: company, role, date and confidences for a message already known to be recruiting activity. */
function buildEvent(email: RecruitingEmail, detected: Detected, subject: string, bodyText: string, given?: CompanyResolution): ExtractedEvent {
  const sender = parseSender(email.from);

  // The employer comes from evidence, never from a single guess (see entity/resolve.ts); no evidence means no company.
  const audit = given ?? resolveCompany({ from: email.from, replyTo: email.replyTo, subject, body: bodyText });
  const company = audit.entity?.name ?? null;
  const reviewReasons: string[] = [];
  if (!company) reviewReasons.push(`company: ${audit.reasons[0] ?? "no corroborating evidence"}`);
  else if (audit.reviewRequired) reviewReasons.push(`company: weak evidence (${[...new Set(audit.evidence.map((e) => e.source))].join(", ") || "none"})`);

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

  // A scheduled interview is a confirmed time. Without one the wording may be a confirmation, an invitation or a reminder: say so.
  let typeConfidence = detected.strength;
  if (detected.type === "interview_scheduled" && !eventDate) {
    typeConfidence = Math.min(typeConfidence, 0.4);
    reviewReasons.push("type: interview wording without a specific time");
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
    fieldConfidence: {
      type: typeConfidence,
      company: Math.round(audit.confidence * 100) / 100,
      role: role ? 0.6 : 0,
    },
    reviewReasons,
    signals: [detected.signal, detected.inSubject ? "subject" : "body"],
  };
}

/** Role mailboxes and bulk senders: their later mail is not evidence of an ongoing candidacy. */
const BULK_LOCALPART = /^(?:no-?reply|do-?not-?reply|notifications?|newsletter|marketing|news|info|hello|team|careers?|jobs?|recruit\w*|talent|hr|events?|updates?|alerts?|mailer|admin|support|help|campus|university|students?)\b/i;

/**
 * Extract events from a batch. Outbound (sent) mail is only kept when it sits in
 * a thread that already has an inbound recruiting event — that is how we learn
 * the user replied, without ingesting the rest of their sent mail.
 */
export function extractAll(emails: RecruitingEmail[]): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const byThread = new Map<string, ExtractedEvent>();
  const byContact = new Map<string, ExtractedEvent>();

  // Stage 1 for the whole batch, then one company resolution over the accepted messages: a sender domain that serves
  // several employers is a vendor, and employers found in a thread are evidence for its other messages.
  const inbound = emails.filter((e) => !e.outbound).map((email) => ({ email, c: classify(email) }));
  const accepted = inbound.filter((x): x is { email: RecruitingEmail; c: Extract<Classified, { reject: null }> } => x.c.reject === null);
  const resolutions = resolveBatch(accepted.map(({ email, c }) => ({ id: email.id, threadId: email.threadId, from: email.from, replyTo: email.replyTo, subject: c.subject, body: c.bodyText })));

  const unmatched: Array<{ email: RecruitingEmail; reason: RejectionReason }> = [];
  for (const { email, c } of inbound) {
    if (c.reject) { unmatched.push({ email, reason: c.reject }); continue; }
    const event = buildEvent(email, c.detected, c.subject, c.bodyText, resolutions.get(email.id));
    events.push(event);
    const existing = byThread.get(event.gmailThreadId);
    if (!existing || (!existing.company && event.company)) byThread.set(event.gmailThreadId, event);
    const sender = parseSender(email.from);
    if (sender.email && classifySender(sender.domain) === "employer" && !BULK_LOCALPART.test(sender.localPart)) byContact.set(sender.email, event);
  }

  // A reply inside a thread we already know is recruiting activity even when its own text carries no keywords
  // ("sounds good, see you then"); so is mail from a named person at an employer who has already written to the reader
  // about a candidacy (travel logistics after an offer). Keep these as neutral updates so the timeline is complete.
  // Auto-replies, promotions and transactional mail are never promoted this way.
  for (const { email, reason } of unmatched) {
    if (reason === "auto_reply" || reason === "marketing" || reason === "transactional" || reason === "non_hiring_event") continue;
    if (processEvidence(email.subject, stripQuoted(email.bodyText)).eventLike) continue; // an invitation to an event is not candidacy traffic, whoever sends it
    const sender = parseSender(email.from);
    const threadAnchor = byThread.get(email.threadId);
    const contactAnchor = threadAnchor ? undefined : reason === "no_recruiting_language" ? byContact.get(sender.email) : undefined;
    const anchor = threadAnchor ?? contactAnchor;
    if (!anchor) continue;
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
      confidence: contactAnchor ? 0.5 : 0.6,
      // Continuity by contact is weaker than continuity by thread: flag the type for review.
      fieldConfidence: { type: contactAnchor ? 0.4 : 0.5, company: Math.round((anchor.fieldConfidence?.company ?? anchor.confidence) * 0.9 * 100) / 100, role: anchor.fieldConfidence?.role ?? 0 },
      reviewReasons: contactAnchor ? ["type: only linked by sender to an earlier candidacy message"] : [],
      signals: [contactAnchor ? "known-contact-continuity" : "reply-in-recruiting-thread"],
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
      fieldConfidence: { type: 0.9, company: anchor.fieldConfidence?.company ?? anchor.confidence, role: anchor.fieldConfidence?.role ?? 0 },
      reviewReasons: [],
      signals: ["outbound-in-recruiting-thread"],
    });
  }

  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}
