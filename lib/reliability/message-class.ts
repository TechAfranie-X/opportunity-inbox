import { ownApplicationStatement, unquoted } from "./evidence.ts";
import { explicitOffer } from "./facts.ts";
import type { RecruitingEmail } from "../recruiting/types.ts";

/**
 * What KIND of message this is, when it is not about the reader's own application. Deterministic wording families, never an employer's template. A class never applies to a message that states the
 * reader's own application ("we received your application", an invitation to interview inside their process).
 *   event               a session, webinar, RSVP, registration, waitlist, office hours, career fair: attending something, not applying for it
 *   survey              a request for feedback
 *   notice              a job-alert / recommendation / "a contact has reached out" notice from a platform
 *   community           a community, workspace or visit registration
 *   program-acceptance  acceptance INTO a programme (a cohort, academy, bootcamp, accelerator, career journey) that is not a job offer: no employment wording, no explicit offer
 */
export type MessageClass = "event" | "survey" | "notice" | "community" | "program-acceptance";
const EVENT = /\b(?:webinar|info(?:rmation)? session|session (?:confirmation|reminder)|you(?:'|’)re registered|registration (?:confirm|reminder)|rsvp\b|wait\s?list|irl event|office hours|virtual (?:event|session|series)|career fair|open evening|meet-?up|tech talk|tech stories|launch your career|ama\b|showcase|(?:event|session) (?:reminder|confirmation|is happening)|your .{0,40}\bevent\b)/i;
const SURVEY = /\b(?:survey|your feedback matters|how did your .{0,40} go|rate your experience|tell us about your experience)\b/i;
const NOTICE = /\b(?:the following contact .{0,60} has reached out|viewed your profile|jobs? (?:matching|for you)|new (?:job )?matches|recommended jobs|job alert|new roles? at)\b/i;
const COMMUNITY = /\b(?:officially connected with|joined the .{0,40} community|welcome to the .{0,40} community|has invited you to (?:work|join)|(?:visit|tour) (?:has been|is) scheduled|thanks for registering for your .{0,30} visit)\b/i;
const ACCEPTED_INTO = /\b(?:congratulations|you(?:'|’)re in\b|you(?:'|’)ve been (?:accepted|selected)|acceptance to|welcome to the)\b/i;
const PROGRAMME = /\b(?:program(?:me)?|academy|cohort|fellowship|bootcamp|accelerator|career journey|institute)\b/i;
const EMPLOYMENT = /\b(?:internship|externship|intern\b|job|position|employment|role\b|compensation|stipend|salary|start date|offer letter|offer of|paid)\b/i;

export function messageClass(m: Pick<RecruitingEmail, "subject" | "bodyText">): MessageClass | null {
  if (ownApplicationStatement(m)) return null;
  const lead = unquoted(`${m.subject}\n${m.bodyText.slice(0, 1600)}`);
  if (SURVEY.test(lead)) return "survey";
  if (NOTICE.test(lead)) return "notice";
  if (COMMUNITY.test(lead)) return "community";
  if (EVENT.test(m.subject) || EVENT.test(lead.slice(0, 500))) return "event";
  if (ACCEPTED_INTO.test(lead) && PROGRAMME.test(lead) && !EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  return null;
}
