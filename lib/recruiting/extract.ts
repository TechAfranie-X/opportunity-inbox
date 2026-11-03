import { parseSender, stripSubjectAnnotations } from "../opportunities/normalize.ts";
import { companyKey, inferRole, roleTokens } from "./company.ts";
import { classifySender, isApplicationPortal } from "./entity/vendors.ts";
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


// Structural cues (a property of the sentence, not a particular wording).
const TIME_OF_DAY = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i;
/** "Your HeadStart Interviews at 2:15pm on Monday is scheduled": an interview, a confirmation word and a time in one sentence. */
function interviewConfirmed(sentence: string) {
  return /\binterview/i.test(sentence) && /\b(?:is|are|was|has been|have been) (?:now )?(?:scheduled|confirmed)\b/i.test(sentence) && !/\b(?:once|after|before|until|when)\b/i.test(sentence) && TIME_OF_DAY.test(sentence);
}
/** "As the next stage … we invite you to create and submit a profile": the next step is a task for the reader. */
function nextStepTask(sentence: string) {
  return /\bnext (?:stage|step)\b/i.test(sentence) && /\b(?:invite you to|you(?:'re| are) invited to|asked to|you (?:will|must|need to)|please)\b[^.]{0,50}\b(?:complete|submit|create|record|upload|take)\b/i.test(sentence);
}

/**
 * How specific a type is. When several types are supported by strong evidence, the most specific one names the event:
 * a reminder about an assessment is an assessment, a confirmation that also asks for a task is the task. Generic
 * types (application received, a nudge, a status line) only win when nothing more specific is supported.
 */
const SPECIFICITY: Record<string, number> = {
  rejection: 100, offer: 95, "request expired": 92, "interview confirmed": 90, "assessment received": 80, assessment: 70,
  "interview invite": 60, "recruiter outreach": 50, "unfinished application reminder": 45, "unfinished application": 45,
  "platform confirmation": 40, "follow up": 30, "application confirmation": 20, "generic update": 10,
};
const STRONG_CUE = 0.65;
/** Types that describe how the message relates to a process rather than what happened in it. A specific event always outranks them. */
const GENERIC_SIGNALS = new Set(["follow up", "unfinished application reminder", "unfinished application", "application confirmation", "generic update", "platform confirmation"]);

// Order no longer decides: evidence is combined (see detectType).
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
    pattern: /\b(?:online assessment|coding assessment|technical assessment|coding challenge|take-?home|invited (?:you )?to (?:complete|take) (?:an? |the )?(?:online )?(?:assessment|challenge|test)|(?:complete|take|submit|finish|start|begin) (?:the|your|an?) (?:[\w-]+ ){0,3}(?:assessment|challenge)|assessment (?:invitation|link)|(?:hackerrank|codesignal|codility|coderpad) (?:assessment|test|challenge|link)|waiting for your .{0,40}assessment)\b/i,
    extra: nextStepTask },
  { type: "interview_scheduled", signal: "interview confirmed", extra: interviewConfirmed,
    pattern: /\b(?:interview (?:is )?(?:confirmed|scheduled)|confirm(?:ing|ation of)? your (?:upcoming )?interview|your (?:upcoming )?interview (?:on|is|will)|\b(?:upcoming|final|technical|virtual|onsite|on-site|panel) interview\b|\bupcoming interviews\b|(?:externship|internship) interview\b|invitation[^:]{0,40}:.{0,80}interview|reminder\W+(?!to schedule).{0,20}interview|interview confirmation|interview schedule|you(?:'re| are) (?:all set|scheduled) for)\b/i },
  { type: "interview_invite", signal: "interview invite",
    pattern: /\b(?:schedule (?:your |an? |the )?(?:interview|call|conversation|time|chat)|(?:invite|like to invite) you (?:to|for) (?:an? |the )?(?:\w+ )?interview|like to interview you|interview invitation|invitation to (?:an? )?interview|invited to interview|reminder to schedule|select (?:a |your )?(?:time|slot)|(?:share|send) (?:me )?your availability|book (?:a )?(?:time|slot)|pick a time)\b/i },
  { type: "recruiter_outreach", signal: "recruiter outreach",
    pattern: /\b(?:i(?:'m| am) (?:a |the )?(?:recruiter|sourcer|talent)|reaching out (?:to you )?(?:about|regarding|because)|came across your (?:profile|resume|background|application)|your (?:background|profile) (?:caught|stood|looks)|chat about (?:an? |the )?(?:opportunity|role|position)|quick (?:call|chat)|(?:wanted|want|would like|am|are|were|was) (?:to )?(?:reach(?:ing)? out|writing to (?:you )?(?:directly|personally))|reach out (?:to you )?directly|invite you to (?:apply|join|interview)|recruiter screen|phone screen|intro call|(?:contact|recruiter|representative|employer|someone) (?:from .{1,70}? )?(?:has|have) reached out|job listing[^.\n]{0,60}application deadline)\b/i },
  { type: "applied", signal: "application confirmation", weak: true,
    pattern: /\b(?:thank(?:s| you)\W+(?:\w+\W+){0,2}for (?:applying|your (?:application|interest in (?:the |our )?(?:[\w&' -]{0,60} )?(?:role|position|internship|opening|job))|submitting)|(?:we(?:'ve| have) )?received your (?:job )?application|application (?:has been |was )?(?:successfully )?(?:received|submitted|completed)|successfully (?:submitted|completed) (?:your|the) application|you have (?:successfully )?applied (?:for|to)|your application (?:to|for|at|with) )\b/i },
  { type: "follow_up", signal: "follow up", weak: true,
    pattern: /\b(?:following up|follow-up(?= (?:email|message|note|on|to|regarding|about|call))|checking in|just checking|any updates?|touching base|(?:finish|complete) your (?:job )?application|final step to complete|days? left to)\b/i },
  { type: "status_update", signal: "generic update", weak: true, subjectOnly: true,
    pattern: /\b(?:application|candidacy|candidate) (?:update|status)|update (?:on|to) your|^(?:an? )?update (?:on|from|regarding|about)\b|an update on|important information about your application|update regarding your|your (?:recent )?(?:job )?application status|your interest in|follow(?:ing)? up (?:on|to) your/i },
  // A request that lapsed is a status line about the opportunity, not a task to do.
  { type: "status_update", signal: "request expired", terminal: true,
    pattern: /\b(?:request|invitation|invite|assessment|link|challenge|test)\b[^.\n]{0,70}\b(?:has|have|had|is|are)\s+(?:now\s+)?expired\b|\bexpired\b[^.\n]{0,30}\b(?:request|invitation|assessment)\b/i },
  // Unfinished-application nudge written in the body ("you did not complete your application").
  { type: "follow_up", signal: "unfinished application",
    pattern: /\b(?:did not|didn't|have not|haven't|not yet|never)\s+(?:yet\s+)?(?:complete[d]?|finish(?:ed)?|submit(?:ted)?)\s+(?:your|the)\s+(?:[\w-]+\s+){0,2}application/i },
];

/** Drop quoted history so a reply doesn't inherit the thread's earlier "offer"/"rejection". */
export function stripQuoted(body: string) {
  const cut = body.search(
    /\n\s*On .{8,140}wrote:|\n\s*-{2,}\s*Original Message|\n\s*From:\s.+\n\s*(?:Sent|Date):|\n\s*_{8,}/i,
  );
  const head = cut >= 0 ? body.slice(0, cut) : body;
  return head.split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
}

type Detected = { type: EventType; signal: string; inSubject: boolean; /** Calibrated trust in the type: evidence strength less the strength of competing evidence. */ strength: number };

type Cue = { rule: Rule; weight: number; inSubject: boolean };

/** Default evidence weight of a rule by where it matched. Weak rules are weak everywhere. */
function weightsOf(rule: Rule) {
  if (rule.weak) return { subject: 0.55, body: rule.subjectOnly ? 0 : 0.5 };
  return { subject: 0.9, body: rule.subjectOnly ? 0 : rule.terminal ? 0.75 : 0.7 };
}

function gatherCues(subject: string, body: string): Cue[] {
  const sentences = body.split(/(?<=[.!?])\s+|\n+/);
  const cues: Cue[] = [];
  for (const rule of RULES) {
    const w = weightsOf(rule);
    const inSubject = ruleMatches(rule, subject);
    const inBody = w.body > 0 && sentences.some((sentence) => ruleMatches(rule, sentence) && !CONDITIONAL.test(sentence));
    if (!inSubject && !inBody) continue;
    // the same wording in both places is one piece of evidence said twice, worth a little more, never a second voice
    const weight = inSubject && inBody ? Math.min(0.95, Math.max(w.subject, w.body) + 0.1) : inSubject ? w.subject : w.body;
    cues.push({ rule, weight, inSubject });
  }
  return cues;
}

/**
 * Evidence is combined, not first-matched. Each rule that fires is a cue with a weight (where it matched, how
 * specific the wording is); cues for the same type combine; then:
 *  - types with strong support compete by specificity (a task in the body names the event even under a generic subject),
 *  - types with only weak support compete by strength,
 *  - confidence is the winner's evidence less the evidence for the runner-up, so a message that argues with itself
 *    is reported as unsure instead of carrying the confidence of whichever rule happened to run first.
 */
function detectType(subject: string, rawBody: string): Detected | null {
  const body = stripQuoted(rawBody).slice(0, 3000);
  const cues = gatherCues(subject, body);
  if (cues.length === 0) return null;

  type Score = { type: EventType; score: number; strong: boolean; specificity: number; top: Cue };
  const byType = new Map<EventType, Score>();
  for (const cue of cues) {
    const cur = byType.get(cue.rule.type);
    const score = cur ? 1 - (1 - cur.score) * (1 - cue.weight) : cue.weight;
    const specificity = SPECIFICITY[cue.rule.signal] ?? 0;
    const top = !cur || cue.weight > cur.top.weight ? cue : cur.top;
    byType.set(cue.rule.type, { type: cue.rule.type, score, strong: (cur?.strong ?? false) || cue.weight >= STRONG_CUE, specificity: Math.max(cur?.specificity ?? 0, specificity), top });
  }
  const generic = (t: Score) => GENERIC_SIGNALS.has(t.top.rule.signal);
  const ranked = [...byType.values()].filter((t) => t.score >= 0.5).sort((a, b) => {
    if (a.strong !== b.strong) return Number(b.strong) - Number(a.strong);
    if (!a.strong) return b.score - a.score || b.specificity - a.specificity;
    // strong evidence: a specific event beats a generic wrapper; between specific events the stronger evidence wins, and
    // comparable evidence is settled by specificity (a confirmed time is more than an invitation to pick one)
    if (generic(a) !== generic(b)) return Number(generic(a)) - Number(generic(b));
    return Math.abs(a.score - b.score) > 0.1 ? b.score - a.score : b.specificity - a.specificity;
  });
  const winner = ranked[0];
  if (!winner) return null;
  const rival = [...byType.values()].filter((t) => t.type !== winner.type).sort((a, b) => b.score - a.score)[0];
  const strength = Math.max(0.2, Math.min(0.95, winner.score) - 0.35 * (rival?.score ?? 0));
  return { type: winner.type, signal: winner.top.rule.signal, inSubject: winner.top.inSubject, strength: Math.round(strength * 100) / 100 };
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

  // Shared vocabulary needs a hiring process behind it. Employment must be the object: an event/course/prize/receipt/broadcast
  // with no candidacy attached is not one, whatever its sender or vocabulary.
  const sender = parseSender(email.from);
  const kind = classifySender(sender.domain);
  const process = processEvidence(subject, bodyText, { employment: (kind === "ats" || kind === "assessment") && !isApplicationPortal(sender.domain), employer: kind === "employer" });
  if (process.transactional) return { reject: "transactional" };
  if (process.eventLike && !process.employment && !process.candidacy) return { reject: "non_hiring_event" };
  if (EVENT_FAKEABLE.has(detected.type) && process.broadcast) return { reject: "non_hiring_event" };
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

  inheritRoles(events);
  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/**
 * A message often says nothing about the role while the opportunity it belongs to does ("see you Thursday", "your offer is
 * ready"). Same thread: the role stated elsewhere in the thread. Otherwise: the one role this employer has in the batch,
 * only when there is exactly one (two roles at one employer is ambiguous, so nothing is guessed). Inherited roles are
 * low-confidence by construction.
 */
function inheritRoles(events: ExtractedEvent[]) {
  const threadRole = new Map<string, string>();
  const withRole = events.filter((e) => !e.outbound && e.role);
  for (const e of withRole) if (!threadRole.has(e.gmailThreadId)) threadRole.set(e.gmailThreadId, e.role!);
  // Same window the opportunity grouping uses for generic roles: months apart is a different opportunity, not the same one.
  const WINDOW = 90 * 86_400_000;
  const soleRoleNear = (e: ExtractedEvent) => {
    if (!e.company) return undefined;
    const roles = new Map<string, string>();
    for (const o of withRole) {
      if (!o.company || companyKey(o.company) !== companyKey(e.company) || Math.abs(o.occurredAt.getTime() - e.occurredAt.getTime()) > WINDOW) continue;
      roles.set(roleTokens(o.role).slice(0, 4).join("-") || o.role!, o.role!);
    }
    return roles;
  };
  for (const e of events) {
    if (e.outbound || e.role) continue;
    const sole = soleRoleNear(e);
    const inherited = threadRole.get(e.gmailThreadId) ?? (sole && sole.size === 1 ? [...sole.values()][0] : null);
    if (!inherited) continue;
    e.role = inherited;
    e.fieldConfidence = { type: e.fieldConfidence?.type ?? e.confidence, company: e.fieldConfidence?.company ?? e.confidence, role: 0.4 };
    e.signals = [...e.signals, "role-inherited"];
  }
}
