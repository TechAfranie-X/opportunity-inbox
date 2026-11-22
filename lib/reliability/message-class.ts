import { campaignFact, marketingFact, namedRole, ownApplicationStatement, ownEnding, programStage, unquoted } from "./evidence.ts";
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
export type MessageClass = "event" | "survey" | "notice" | "community" | "admin" | "logistics" | "marketing" | "draft" | "program-acceptance";
const EVENT = /(?:you(?:'|’)re registered for|you are registered for|you have successfully registered|successful registration|registration (?:pending|received|successful)|pending approval for|thank you for registering for)|(?:^\s*(?:confirmed|reminder|canceled|cancelled|rescheduled)\s*:[^.\n]{0,140}\b(?:on|at)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day\b)|\b(?:(?:hackathon|webinar|workshop|conference|summit|symposium|career fair|event) registration|registration (?:update|status|decision)|your registration for|webinar|info(?:rmation)? session|session (?:confirmation|reminder)|you(?:'|’)re registered|registration (?:confirm|reminder)|rsvp\b|wait\s?list|irl event|office hours|(?:this|our) event\b|joining us at|capacity restrictions|(?:your|first|next|upcoming) (?:section|class|lesson|lecture)|section (?:leader|reminder)|course (?:starts|begins|reminder)|study group|deep work session|virtual (?:event|session|series)|career fair|open evening|meet-?up|tech talk|tech stories|launch your career|ama\b|showcase|(?:event|session) (?:reminder|confirmation|is happening)|your .{0,40}\bevent\b)/i;
/** An application the reader STARTED and has not submitted ("your application is incomplete", "complete your application", a saved draft, "you still have an application to work on"): evidence of intent, never an application. */
const DRAFT = /\b(?:incomplete (?:job )?application|application (?:is |remains |still )?(?:incomplete|unfinished|not (?:yet )?(?:complete|submitted))|unfinished application|(?:complete|finish|submit) your (?:[\w'’&-]+ ){0,4}application|you still have an application to work on|saved a draft of your (?:job )?application|continue to apply for the job|your (?:[\w'’&-]+ ){0,3}application is waiting|started your (?:[\w'’&-]+ ){0,3}application|your application to [\w .&'’-]{2,50} is due (?:tomorrow|today|soon)|you(?:'|’)re almost finished)\b/i;
const NOT_DRAFT = /\b(?:assessment|interview|coding challenge|hirevue|codesignal|hackerrank|video response|online test)\b/i;
const SURVEY_SUBJECT = /\b(?:how did your [\w .&'’-]{0,40}(?:interview|assessment|test) go|share your (?:\w+ )?(?:interview )?experience)\b/i;
const SURVEY = /\b(?:survey|your feedback matters|rate your experience|tell us about your experience)\b/i;
const NOTICE = /(?:\bweekly digest\b|\bnewsletter\b|^\s*(?:fwd?|fw)\s*:|(?:^|\n)\s*-{3,}\s*forwarded message\s*-{3,}|^\s*(?:fwd?|fw)\s*:)|(?:^\s*ripplematch\b|\bripplematch:|\bnew message from [\w ]{2,40} at [\w .&'’-]{2,40}(?: college| university)|booth at|stopping by our (?:\w+ ){0,2}booth)|\b(?:is hiring|are hiring|now open|applications? (?:are )?(?:now )?open|internship opportunity:|your internship match)\b|\b(?:reacted to this post|talent community|stay (?:connected|in touch)|(?:candidate|talent) profile|you have \d+ (?:new )?(?:job )?matches|job matches|you matched|internship alert|the following contact .{0,60} has reached out|viewed your profile|jobs? (?:matching|for you)|new (?:job )?matches|recommended jobs|job alert|new roles? at)\b/i;
const COMMUNITY = /\b(?:virtual (?:job |work )?experience program|job simulation|(?:forage|theforage)\b[^.\n]{0,60}(?:simulation|experience)|officially connected with|joined the .{0,40} community|welcome to the .{0,40} community|has invited you to (?:work|join)|(?:visit|tour) (?:has been|is) scheduled|thanks for registering for your .{0,30} visit)\b/i;
const ADMIN = /\b(?:thanks for filling out this form|here(?:'|’)s what was received|finish your [\w ]{0,30}setup|complete verification|identity verification through persona|verification (?:was )?successful|you(?:'|’)ve been verified|email verification|verify your (?:email|account)|password (?:has been )?(?:reset|changed)|your password|confirm your identity|test report is available|w-?8ben|eligibility profile|identity verification|verify (?:your )?identity|security code|verification code|access code|one[- ]time (?:pass)?code|verify your (?:email|e-mail|account|identity)|password (?:reset|change)|sign-?in (?:link|code)|log-?in (?:link|code)|candidate verification|confirm your (?:email|e-mail)(?: address)?|(?:communication|email|e-mail|notification) preferences|manage your preferences)\b/i;
const LOGISTICS = /\b(?:itinerary|flight (?:approval|reservation|booking|option)|travel request|background (?:check|investigation|verification)|travel (?:itinerary|booking|arrangements?|confirmation)|reimbursement|expense (?:report|form)|immigration|visa (?:sponsorship|support)|headshot|direct deposit|onboarding (?:documents|checklist|tasks?))\b/i;
const IMMIGRATION_LEAD = /\b(?:immigration|work authori[sz]ation|visa (?:sponsorship|petition|application)|h-?1b|cpt|opt\b|i-?9|petition (?:forms?|documents?))\b/i;
const INVITED_PROGRAM = /\b(?:invitation to join|invited to join|invite you to join) (?:our|the) [^.]{0,90}\b(?:program(?:me)?|cohort|academy|bootcamp|certificate|fellowship)\b/i;
const PROCESS_WORDS = /\b(?:assessment|interview|candidate|position|role|screening|pre-?screen|hiring|recruit\w*|coding challenge|online test)\b/i;
const HARD_EMPLOYMENT = /\b(?:offer letter|offer of employment|salary|compensation|start date|full-time position|pleased to offer)\b/i;
const ACCEPTED_INTO = /\b(?:invitation to join (?:our|the)|(?:thrilled|pleased|excited) to (?:extend an invitation|invite you) to join|congratulations|you(?:'|’)re in\b|you(?:'|’)ve been (?:accepted|selected)|acceptance to|welcome to the)\b/i;
const PROGRAMME = /\b(?:program(?:me)?|academy|cohort|fellowship|bootcamp|accelerator|career journey|institute)\b/i;
const EMPLOYMENT = /\b(?:internship|externship|intern\b|job|position|employment|role\b|compensation|stipend|salary|start date|offer letter|offer of|paid)\b/i;

/** The employer asks the reader to take a step in their OWN process (an interview invitation, an assessment to complete): never an event, whatever else the message says. */
const OWN_STEP = /\b(?:you have an? (?:upcoming |scheduled )?(?:\w+ )?interview|(?:upcoming|scheduled) (?:virtual |phone |technical |final )?interview (?:with|at|on)|interview (?:with|at) [A-Z]|(?:would like to )?invite you to (?:our |an? |the |your )?[\w -]{0,40}\binterviews?\b|(?:schedule|book) your (?:\w+ )?interview|your (?:upcoming )?(?:\w+ )?interview (?:is|has been|will)|complete (?:your|the|an?) (?:online )?(?:assessment|coding challenge))/i;
export function messageClass(m: Pick<RecruitingEmail, "subject" | "bodyText">): MessageClass | null {
  if (ownApplicationStatement(m)) return null;
  const lead = unquoted(`${m.subject}\n${m.bodyText.slice(0, 1600)}`);
  if (OWN_STEP.test(lead)) return null;
  if (ACCEPTED_INTO.test(lead) && PROGRAMME.test(lead) && !EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  // the programme says the reader was accepted ("this is a formal invitation to join … we reviewed 66,000 applications and were impressed with yours")
  // a SUBJECT that says the reader is in a named programme ("You're in the X Academy") is an acceptance whatever the body says about interview prep or recruiting
  if (/\b[Yy]ou(?:'|’)re (?:officially )?(?:in|accepted into|admitted to) (?:the )?[A-Z][\w &'’-]{2,50}\b(?:Academy|Program|Programme|Cohort|Fellowship|Bootcamp|Institute|Course)\b/.test(m.subject) && !HARD_EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  // selected into a NAMED programme (a position the message states that is itself a programme): an acceptance even when the programme later connects the person with recruiters
  const namedProgramme = namedRole(m);
  if (programStage(m) === "accepted" && namedProgramme && PROGRAMME.test(namedProgramme) && !/\b(?:intern(?:ship)?|engineer|analyst|developer)\b/i.test(namedProgramme) && !HARD_EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  if (programStage(m) === "accepted" && !PROCESS_WORDS.test(lead) && !HARD_EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  // advancing through a programme (completion of one level, invitation to the next) is programme evidence of acceptance
  const ps = programStage(m);
  if ((ps === "completed" || ps === "invited") && /\b(?:level|module|cohort|track|series|phase|certificate)\b/i.test(lead) && !PROCESS_WORDS.test(lead) && !HARD_EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  // an invitation to JOIN a programme is a programme acceptance even if the programme mentions internships; only hard employment terms make it an offer
  if (INVITED_PROGRAM.test(lead) && !HARD_EMPLOYMENT.test(lead) && explicitOffer(m as RecruitingEmail) === null) return "program-acceptance";
  if (ADMIN.test(m.subject) || ADMIN.test(m.bodyText.slice(0, 200))) return "admin";
  if ((LOGISTICS.test(m.subject) || IMMIGRATION_LEAD.test(m.bodyText.slice(0, 400))) && explicitOffer(m as RecruitingEmail) === null) return "logistics";
  if (campaignFact(m)) return "marketing";
  if (DRAFT.test(lead) && !NOT_DRAFT.test(lead.slice(0, 900)) && !ownEnding(m) && explicitOffer(m as RecruitingEmail) === null) return "draft";
  if (SURVEY_SUBJECT.test(m.subject) || SURVEY.test(m.subject) || SURVEY.test(m.bodyText.slice(0, 400))) return "survey";
  // (a platform notice never swallows the employer saying the reader's own application ended: "stay in touch" in a rejection's closing line is not a notice)
  if (NOTICE.test(lead) && !ownEnding(m) && !programStage(m)) return "notice";
  if (COMMUNITY.test(lead)) return "community";
  if (EVENT.test(m.subject) || EVENT.test(lead.slice(0, 500))) return "event";
  if (marketingFact(m)) return "marketing";
  return null;
}
