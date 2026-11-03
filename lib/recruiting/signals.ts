/**
 * Message-level signals shared by the extractor. Each one encodes a general property of how recruiting mail is
 * written, not a phrasing taken from a particular sender. Pure functions over text; nothing is stored.
 */

/** Wording that makes a sentence hypothetical, so it must not decide the event type. */
export const CONDITIONAL =
  /\b(?:if|should|in case|in the event|unless|until|whether|either|candidates who|those who|that means|may be|might|could be|will be contacted|you may be asked|are selected|is selected|when you)\b/i;

// ---------------------------------------------------------------------------------------------------------------
// Negative outcome
// A rejection is not a phrase list, it is a structure: a negation or inability, applied to a progression verb
// ("move forward", "proceed", "extend an offer"), in a sentence that is a decision about the reader's candidacy.
// Covering the structure covers "decided not to move forward", "unable to proceed with your candidacy", "not able
// to extend an invitation", "will not be advancing" without listing each wording.
// ---------------------------------------------------------------------------------------------------------------
const NEGATION = String.raw`(?:not|unable to|cannot|can(?:'|’)t|won(?:'|’)t|no longer)`;
const PROGRESS_VERB = String.raw`(?:move|moving|proceed|proceeding|advance|advancing|progress|progressing|continue|continuing)`;
const NEGATED_PROGRESS = new RegExp(String.raw`\b${NEGATION}(?: (?:be )?(?:able|going|planning|continuing|moving))?(?: to)? (?:\w+ ){0,2}?${PROGRESS_VERB}\b`, "i");
const NEGATED_EXTEND = new RegExp(String.raw`\b${NEGATION}(?: (?:be )?able)?(?: to)? (?:\w+ ){0,2}?(?:extend|make) (?:an? |the |you an? )?(?:invitation|invite|offer)\b`, "i");
/** The sentence is about a decision on the reader's candidacy, not an instruction ("you cannot proceed until you verify"). */
const DECISION_FRAME = /\b(?:decided|decision|determined|unfortunately|regret|after (?:careful|much|further) (?:review|consideration|deliberation)|(?:your )?(?:candidacy|application|candidate|consideration))\b/i;
const NOT_A_DECISION = /\b(?:reschedul\w*|another time|alternative|instead|available)\b/i;

export function isNegativeOutcome(sentence: string): boolean {
  if (CONDITIONAL.test(sentence) || NOT_A_DECISION.test(sentence)) return false;
  if (NEGATED_EXTEND.test(sentence) && /\b(?:you|your|candidacy|application)\b/i.test(sentence)) return true;
  return NEGATED_PROGRESS.test(sentence) && DECISION_FRAME.test(sentence) && /\b(?:you|your|candidacy|application|candidate)\b/i.test(sentence);
}

// ---------------------------------------------------------------------------------------------------------------
// Automatic replies
// An out-of-office notice is a machine answering for a person. It is context about the thread, never a lifecycle event
// (so it can neither advance an opportunity nor be typed from the boilerplate it quotes).
// ---------------------------------------------------------------------------------------------------------------
const AUTO_SUBJECT = /^\s*(?:automatic reply|auto-?reply|autoreply|out of (?:the )?office|undeliverable|delivery status)\b|\b(?:ooo|out of (?:the )?office|automatic reply)\b/i;
const AUTO_STATEMENT = /\b(?:this is an? (?:automatic|automated|auto)[- ]?(?:reply|response|message)|automatic(?:ally)? generated|auto-?reply)\b/i;
const ABSENCE = /\b(?:i am|i'm|i will be|i'll be|we are|we're|currently)\s+(?:currently\s+)?(?:out of (?:the )?office|away from (?:my|the) (?:desk|office|email|inbox)|on (?:vacation|leave|holiday|pto|parental leave|maternity leave)|travell?ing)\b|\b(?:will|do|does) (?:have )?(?:limited|no) (?:access to )?(?:my )?(?:email|inbox)\b|\bnot have access to (?:my )?(?:inbox|email)\b|\bwill respond (?:to all messages )?when i return\b/i;
const ACKNOWLEDGES_RECEIPT = /\b(?:thank(?:s| you) for (?:your |reaching out|contacting)(?:\s*(?:email|message|note))?)\b/i;

export function isAutoReply(subject: string, body: string): boolean {
  if (AUTO_SUBJECT.test(subject)) return true;
  const head = body.slice(0, 700);
  if (AUTO_STATEMENT.test(head.slice(0, 300))) return true;
  // A person writing "I'll be out Friday" is not an auto-reply; a machine answers a message ("thanks for your email") and says it is away.
  return ABSENCE.test(head) && ACKNOWLEDGES_RECEIPT.test(head.slice(0, 220));
}

// ---------------------------------------------------------------------------------------------------------------
// Is this about the reader's hiring process?
// Weak language ("thank you for your interest", "I'd like to chat", "pick a time") is shared by hiring mail,
// event registrations, bootcamp promotions, prize nominations, receipts and marketplace messages. It only counts as
// recruiting when the message also shows that *employment* is the object: a job, role, position, internship or
// candidacy, or a sender whose business is hiring. The word "application" alone proves nothing (prizes, scholarships,
// faculty searches and conference slots all have applications).
// ---------------------------------------------------------------------------------------------------------------
const EMPLOYMENT_OBJECT = /\b(?:jobs?|roles?|positions?|internships?|interns?|externships?|co-?op|requisitions?|employment|employer|candidates?|candidacy|hiring|recruit(?:er|ers|ing|ment)|talent acquisition|offer letter|full-time|part-time|apprenticeship|fellowship|interview(?:s|ing|er)?|assessment)\b/i;
/** Language that ties the message to a specific candidacy rather than to a program or event. */
const CANDIDACY_ANCHOR = /\b(?:your (?:job |internship )?application (?:for|to|at|with)|you (?:have )?applied (?:for|to)|your candidacy|requisition|job (?:id|number|req)|(?:the |this )?(?:[\w-]+ ){0,3}(?:position|role) (?:of|at|for)|hiring (?:manager|team)|talent acquisition|interview with|recruiter)\b/i;
/** A registration, event, course or promotion: shared vocabulary of programs that are not a hiring process. */
const EVENT_CONTEXT = /\b(?:hackathon|webinar|workshop|conference|summit|boot ?camp|info(?:rmation)? session|open house|networking event|career fair|register(?:ed|ing)?|registration|enroll(?:ed|ment|ing)?|tuition|cohorts?|attend(?:ance|ing)?|rsvp|newsletter|discount|coupon|promo(?:tion)?|prize|nominee|nomination|scholarship)\b/i;
/** Receipts and invoices quote money next to a transaction word; hiring mail does not. */
const TRANSACTION = /\$\s?\d[\d,]*(?:\.\d{2})\b/;
const TRANSACTION_WORD = /\b(?:receipt|invoice|subtotal|total|fare|payment|charged|order|trip|refund)\b/i;
/** "Applications will open on …", "applications are now live": a broadcast about a programme, unless it is written to the reader. */
const OPENING_ANNOUNCEMENT = /\bapplications?\b[^.\n]{0,90}\b(?:will open|opens?|opening|(?:are|is) (?:now )?(?:open|live)|go(?:es)? live)\b/i;
const PERSONAL_OUTREACH = /\b(?:reach(?:ing)? out|invite you|we noticed you|you(?:'ve| have) (?:previously )?(?:connected|applied|expressed|started)|your (?:profile|background|resume))\b/i;

export type Sender = { employment: boolean; employer: boolean };
export type ProcessEvidence = { anchored: boolean; employment: boolean; eventLike: boolean; candidacy: boolean; transactional: boolean; broadcast: boolean };

export function processEvidence(subject: string, body: string, sender: Sender = { employment: false, employer: false }): ProcessEvidence {
  const text = `${subject}\n${body.slice(0, 1500)}`;
  const head = `${subject}\n${body.slice(0, 600)}`;
  const employment = EMPLOYMENT_OBJECT.test(text);
  const candidacy = CANDIDACY_ANCHOR.test(text);
  return {
    // an employer's own "application" is about a job; a portal's or a stranger's is not
    anchored: employment || sender.employment || (sender.employer && /\bapplications?\b/i.test(text)),
    employment: employment || sender.employment,
    eventLike: EVENT_CONTEXT.test(`${subject}\n${body.slice(0, 1200)}`),
    candidacy,
    transactional: TRANSACTION.test(head) && TRANSACTION_WORD.test(head),
    broadcast: OPENING_ANNOUNCEMENT.test(head) && !PERSONAL_OUTREACH.test(head) && !candidacy,
  };
}
