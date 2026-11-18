import { findDateMentions } from "../recruiting/dates.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
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
