import { classifyOpportunityEmail } from "../opportunities/classify.ts";
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

type Rule = { type: EventType; signal: string; pattern: RegExp; subjectOnly?: boolean };

// Order = priority. Terminal and most-specific outcomes first.
const RULES: Rule[] = [
  { type: "rejection", signal: "rejection",
    pattern: /\b(?:not (?:be )?(?:moving|proceeding|going) forward|will not be (?:moving|proceeding)|regret to inform|decided to (?:move|go|proceed) (?:forward )?with (?:other|another)|pursue (?:other|another) (?:candidates?|applicants?)|unfortunately,? (?:we|after)|position has been filled|not (?:been )?selected|unable to (?:offer|move forward))\b/i },
  { type: "offer", signal: "offer",
    pattern: /\b(?:pleased to (?:extend|offer)|(?:extend|extending) (?:you )?(?:an? |the )?offer|offer letter|offer of employment|formal offer|excited to offer you|your offer)\b/i },
  { type: "assessment_completed", signal: "assessment received",
    pattern: /\b(?:thank(?:s| you) for (?:completing|submitting)|we(?:'ve| have) received your (?:assessment|submission|solution)|assessment (?:complete|completed|received|submitted)|submission received)\b/i },
  { type: "assessment", signal: "assessment",
    pattern: /\b(?:online assessment|coding assessment|technical assessment|coding challenge|take-?home|hackerrank|codesignal|codility|invited to (?:complete|take) (?:an? |the )?(?:online )?(?:assessment|challenge|test)|complete (?:the|your|an?) (?:online |coding )?(?:assessment|challenge)|assessment (?:invitation|link))\b/i },
  { type: "interview_scheduled", signal: "interview confirmed",
    pattern: /\b(?:interview (?:is )?(?:confirmed|scheduled)|confirm(?:ing|ation of)? your (?:upcoming )?interview|your (?:upcoming )?interview (?:on|is|will)|invitation: .*interview|you(?:'re| are) (?:all set|scheduled) for)\b/i },
  { type: "interview_invite", signal: "interview invite",
    pattern: /\b(?:schedule (?:your |an? |the )?(?:interview|call|conversation)|(?:invite|like to invite) you (?:to|for) (?:an? |the )?(?:\w+ )?interview|like to interview you|select (?:a |your )?(?:time|slot)|(?:share|send) (?:me )?your availability|book (?:a )?(?:time|slot)|pick a time|next (?:round|steps?))\b/i },
  { type: "recruiter_outreach", signal: "recruiter outreach",
    pattern: /\b(?:i(?:'m| am) (?:a |the )?(?:recruiter|sourcer|talent)|reaching out (?:to you )?(?:about|regarding|because)|came across your (?:profile|resume|background|application)|your (?:background|profile) (?:caught|stood|looks)|chat about (?:an? |the )?(?:opportunity|role|position)|quick (?:call|chat)|recruiter screen|phone screen|intro call)\b/i },
  { type: "applied", signal: "application confirmation",
    pattern: /\b(?:thank(?:s| you) for (?:applying|your (?:application|interest))|(?:we(?:'ve| have) )?received your application|application (?:has been )?(?:received|submitted)|successfully (?:submitted|applied)|your application (?:to|for|at|with))\b/i },
  { type: "follow_up", signal: "follow up",
    pattern: /\b(?:following up|follow-up|checking in|just checking|any updates?|status of your application|touching base)\b/i },
];

const WITHDRAW = /\b(?:withdraw(?:ing)? (?:my|from)|please withdraw|no longer (?:interested|available))\b/i;

const SCHEDULE_TYPES: EventType[] = ["interview_scheduled"];
const DEADLINE_TYPES: EventType[] = ["assessment", "offer", "interview_invite", "recruiter_outreach"];

function detectType(subject: string, body: string): { type: EventType; signal: string; inSubject: boolean } | null {
  const head = body.slice(0, 3000);
  for (const rule of RULES) {
    if (rule.pattern.test(subject)) return { type: rule.type, signal: rule.signal, inSubject: true };
    if (!rule.subjectOnly && rule.pattern.test(head)) return { type: rule.type, signal: rule.signal, inSubject: false };
  }
  return null;
}

/**
 * Extract a structured event from one *inbound* email, or null if it isn't
 * recruiting activity. Outbound mail is handled by `extractAll`.
 */
export function extractEvent(email: RecruitingEmail): ExtractedEvent | null {
  const sender = parseSender(email.from);
  const subject = email.subject.trim();
  const normalizedSubject = stripSubjectAnnotations(subject);

  // Cheap veto: reuse the metadata classifier to drop obvious marketing/noise.
  const classification = classifyOpportunityEmail({ subject, from: email.from });
  if (classification.label === "not_opportunity" && classification.pipelineScore === 0) {
    return null;
  }

  const detected = detectType(normalizedSubject, email.bodyText);
  if (!detected) return null;

  // "offer"/"next steps" words are common in marketing; require some recruiting context.
  if (
    (detected.type === "offer" || detected.type === "interview_invite" || detected.type === "follow_up") &&
    !/\b(?:applica|candidate|interview|role|position|intern|recruit|team|hiring|career|job)\w*/i.test(`${subject} ${email.bodyText.slice(0, 1500)}`)
  ) {
    return null;
  }

  const company = inferCompany({ from: email.from, subject, body: email.bodyText });
  let role = inferRole(subject, email.bodyText);
  if (role && company && role.toLowerCase().startsWith(`${company.toLowerCase()} `)) {
    role = role.slice(company.length + 1); // "Datadog Backend Engineer" -> "Backend Engineer"
  }

  let eventDate: Date | null = null;
  let eventDateHasTime = false;
  let dateKind: ExtractedEvent["dateKind"] = null;
  if (SCHEDULE_TYPES.includes(detected.type)) {
    const picked = pickDate(`${subject}\n${email.bodyText.slice(0, 3000)}`, email.receivedAt, "scheduled");
    if (picked) { eventDate = picked.date; eventDateHasTime = picked.hasTime; dateKind = "scheduled"; }
  } else if (DEADLINE_TYPES.includes(detected.type)) {
    const picked = pickDate(`${subject}\n${email.bodyText.slice(0, 3000)}`, email.receivedAt, "deadline");
    // Only trust dates for these types when a deadline cue sits nearby (pickDate falls back loosely).
    if (picked && detected.type !== "recruiter_outreach" && detected.type !== "interview_invite") {
      eventDate = picked.date; eventDateHasTime = picked.hasTime; dateKind = "deadline";
    }
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

  for (const email of emails.filter((e) => !e.outbound)) {
    const event = extractEvent(email);
    if (!event) continue;
    events.push(event);
    const existing = byThread.get(event.gmailThreadId);
    if (!existing || (!existing.company && event.company)) byThread.set(event.gmailThreadId, event);
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
