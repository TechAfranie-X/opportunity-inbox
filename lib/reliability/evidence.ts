import { findDateMentions } from "../recruiting/dates.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";

/**
 * Evidence integrity facts (audit remediation). Each reads the message text while it is in memory (bodies are never stored) and records WHAT KIND of evidence a message is,
 * so later stages never mistake it for something else. None invents an event.
 *
 *  unquoted        only the part of a message its sender wrote now: quoted history ("On ... wrote:", "> ...", forwarded headers) is somebody's earlier words, often the
 *                  student's own ("my other offer expires Nov 30"), and must never become the sender's deadline.
 *  closure         explicit, terminal wording from the employer ("no longer under consideration", "we will not be moving forward", "position has been filled").
 *  marketing       bulk mail: job-alert digests, newsletters, promotions. Recognised by what a message IS (digest subject; unsubscribe + postal footer + no personal anchor),
 *                  never by who sent it.
 *  date binding    a date belongs to the thing it is about: not to quoted history, not to a competing offer, not to the sender's promise to update, not to a cancelled event.
 */

export const QUOTE_START = [
  /^\s*>/m,
  /^\s*On .{3,160}wrote:\s*$/m,
  /^\s*-{2,}\s*(?:original message|forwarded message)\s*-{2,}/im,
  /^\s*(?:From|De|Von|Da):\s.+\n\s*(?:Sent|Date|Envoy[ée]|Gesendet|Enviado):/im,
  /^\s*-{2,}\s*(?:Original|Forwarded) message\s*-{2,}/im,
  /^\s*Begin forwarded message:/im,
  /^\s*Le .{3,160}a [ée]crit\s*:/m,
  /^\s*Am .{3,160}schrieb .{0,80}:/m,
  /^\s*El .{3,160}escribi[óo]:/m,
];

/** The text the sender wrote in THIS message, without quoted history. */
export function unquoted(text: string): string {
  text = text.replace(/&nbsp;|&#160;|\u00a0/gi, " ").replace(/&amp;/gi, "&"); // (a mailer's literal entities must not glue words together)
  let cut = text.length;
  for (const re of QUOTE_START) { const m = re.exec(text); if (m && m.index < cut) cut = m.index; }
  return text.slice(0, cut);
}

// -------------------------------------------------------------------- closure
/**
 * Terminal wording. Deliberately strict: the phrase must speak about the reader's own application/candidacy, and "no longer" job-posting or mailing-list wording is excluded.
 * Wording families (English, Spanish, French, German, Portuguese, Italian), not any one employer's template.
 */
const CLOSURE = new RegExp([
  String.raw`\b(?:no longer (?:be )?(?:under consideration|being considered|considered|moving forward|in consideration)|will not be (?:moving|proceeding|continuing|advancing|going) forward|not (?:be )?(?:moving|proceeding|advancing|continuing) (?:forward )?with your (?:application|candidacy)|(?:have|has) decided not to (?:move|proceed|continue|advance|pursue)|decided to (?:move|proceed|go) forward with (?:other|another|different) candidates?|position (?:has been|was|is) (?:filled|closed|cancel{1,2}ed)|(?:application|candidacy) (?:has been|was|is) (?:closed|declined|not selected)|(?:we|i) (?:regret|are sorry|am sorry) to (?:inform|tell|let) you|not (?:been )?selected for (?:this|the|an?) (?:position|role|opportunity|internship|program))\b`,
  String.raw`\bne (?:sera|seront) pas (?:retenue?s?|poursuivie?s?)\b|\bn['’]a pas été retenue?\b|\bcandidature n['’]a pas été (?:retenue|s[ée]lectionn[ée]e)\b`,
  String.raw`\bno (?:ha sido|hemos) seleccionad[ao]\b|\bdecidimos no continuar\b|\bno continuaremos con su candidatura\b|\bsu candidatura no (?:ha sido )?(?:seleccionada|continuar[áa])\b`,
  String.raw`\bleider (?:k[öo]nnen|müssen) wir\b[^.!?]{0,60}\b(?:nicht|absagen)\b|\bwir (?:haben uns|m[öo]chten) .{0,40}gegen (?:ihre|eine) bewerbung entschieden\b|\bnicht weiter ber[üu]cksichtigen\b`,
  String.raw`\bn[ãa]o (?:foi|ser[áa]) selecionad[oa]\b|\bdecidimos n[ãa]o (?:seguir|continuar|prosseguir)\b|\bn[ãa]o (?:vamos|iremos) (?:seguir|prosseguir|continuar) com a sua candidatura\b`,
  String.raw`\bnon (?:sar[àa]|è stata) (?:selezionat[ao]|presa in considerazione)\b|\bnon proseguiremo con la sua candidatura\b`,
].join("|"), "i");
/** Wording that mentions closure without ending the reader's candidacy. */
const CLOSURE_NOT_ABOUT_YOU = /\b(?:no longer (?:accepting|receive|receiving|available for|supported|offered)|you (?:will|may) no longer (?:receive|get)|unsubscribe|this (?:job|posting|listing) (?:is|has been|was) (?:closed|filled|removed)|jobs? (?:you|matching)|similar jobs?)\b/i;
const OFFER_OR_NEXT = /\b(?:pleased to (?:offer|invite|inform you that you)|congratulations|you(?:'ve| have) (?:been )?(?:selected|advanced|moved)|next (?:steps|round)|invite you to)\b/i;

/** Which part of the closure test decided (booleans only; used by read-only audit probes, never prints text). */
export function closureDiagnose(email: Pick<RecruitingEmail, "subject" | "bodyText">) {
  const text = unquoted(`${email.subject}\n${email.bodyText}`);
  const closure = CLOSURE.exec(text);
  return { closure: !!closure, notAboutYou: CLOSURE_NOT_ABOUT_YOU.test(text), anchorBefore: closure ? OFFER_OR_NEXT.test(text.slice(0, closure.index)) : false, quotedCut: text.length < `${email.subject}\n${email.bodyText}`.length };
}

export function closureFact(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const text = unquoted(`${email.subject}\n${email.bodyText}`);
  const closure = CLOSURE.exec(text);
  if (!closure || CLOSURE_NOT_ABOUT_YOU.test(text)) return false;
  // a positive anchor ("congratulations", "next round", "invite you") BEFORE the closure phrase means the closure words belong to a conditional or a different matter
  const anchor = OFFER_OR_NEXT.exec(text.slice(0, closure.index));
  return !anchor;
}

/**
 * A BROADER test than `closureFact`: does the message contain a sentence that ends the reader's application, in everyday wording ("we regret to inform you", "we've decided to pursue other
 * candidates", "unable to move forward with your application", "not selected", "won't be moving forward with your candidacy")? `closureFact` is deliberately strict (it can confirm without error) and on
 * real mail it recognised fewer than half of the genuine rejections, so it cannot decide anything on its own. This one is the corroboration a rule-found rejection needs before it SETTLES an
 * application: the reader's type plus an actual ending sentence. Without one the ending is only proposed. Wording families, not any employer's template.
 */
const ENDING_CUE = new RegExp([
  String.raw`\b(?:unfortunately|regret(?:fully)?\b|we are sorry to|we(?:'|’)re sorry to|sorry to (?:inform|tell|let you know)|not (?:be )?(?:moving|proceeding|progressing|advancing|continuing)\b|(?:will|would|do|does|are|were|we(?:'|’)re|we are|can)\s*not (?:be )?(?:able to )?(?:move|moving|proceed|proceeding|progress|progressing|extend|offer|continue|continuing|select|selecting|consider|considering|invite|inviting)\b|won(?:'|’)t be (?:moving|proceeding|progressing|able|continuing)|unable to (?:move|proceed|progress|extend|offer|continue|invite|advance)|not (?:been )?(?:selected|shortlisted|successful|eligible|chosen)|(?:decided|chosen|chose|opted) (?:not to|to (?:pursue|move forward with|proceed with|go (?:in|with)|take|select|continue with))|(?:pursue|pursuing|move forward with|proceed with|moving forward with) (?:other|another|different) (?:candidate|applicant|direction)|other (?:candidates?|applicants?)\b|different direction|(?:position|role|vacancy) (?:has|have) (?:been )?filled|(?:made|make|reached|come to) (?:the|a) decision not to|concluded (?:the|our) (?:search|hiring)|(?:completed|finished|closed) (?:our )?hiring for|more (?:applications|applicants|candidates) than we (?:are|were) able|not (?:been )?chosen|unable to offer|not able to (?:offer|extend)|declin(?:e|ed|ing) your application|no longer (?:be )?(?:under consideration|being considered|considered|in consideration))`,
].join("|"), "i");
const FIRST_PERSON = /\b(?:I|I'm|I’m|I've|I’ve|I'd|my|myself)\b/;
const EMPLOYER_VOICE = /\b(?:we|our|us|your|you)\b/i;
const CONDITIONAL_BEFORE = /\b(?:if|should|in the event|unless|in case|whether|when)\b/i;
const CONDITIONAL_AFTER = /\b(?:if|unless|until|in case)\b/i;
const NO_LONGER_REVIEWING = /\b(?:(?:decided|decision|chosen|elected|opted) (?:to |not to )?not (?:to )?(?:move|proceed|continue|advance|go) forward|(?:decided|decision|chosen|elected|opted) not to (?:move|proceed|continue|advance|go) forward|(?:we are|we(?:'|’)re|are) no longer (?:reviewing|accepting|considering) (?:any )?(?:applicants|applications|candidates)|(?:this|the) (?:position|role) (?:has been|is now|was) (?:filled|closed)|(?:positions?|roles?) (?:have|has) been filled)\b/i;
/** The sentence of THIS message (not quoted history) that ends the reader's application, or null. */
export function endingSentence(email: Pick<RecruitingEmail, "subject" | "bodyText">): string | null {
  // soft-wrapped lines (a single newline inside a sentence) are one sentence; blank lines and sentence ends separate
  const text = unquoted(`${email.subject}\n\n${email.bodyText}`).replace(/\r/g, "").replace(/(?<![.!?:\n])\n(?![\n\-*•])/g, " ");
  // judged sentence by sentence: a footer that says "unsubscribe" must not hide an ending sentence elsewhere in the message
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (sentence.length > 400 || CLOSURE_NOT_ABOUT_YOU.test(sentence)) continue;
    // the reader's own narration ("Unfortunately, I was ill and could not reply") is not an employer ending a process: an employer speaks as we/our to you/your
    if (FIRST_PERSON.test(sentence) && !EMPLOYER_VOICE.test(sentence)) continue;
    const cue = ENDING_CUE.exec(sentence) ?? NO_LONGER_REVIEWING.exec(sentence);
    // a CONDITION is not an ending: "If you are not selected, keep an eye on our jobs page", "You will not be able to proceed if the questionnaire is not completed"
    if (cue && (CONDITIONAL_BEFORE.test(sentence.slice(0, cue.index)) || CONDITIONAL_AFTER.test(sentence.slice(cue.index + cue[0].length)))) continue;
    if (cue && !OFFER_OR_NEXT.test(sentence.slice(0, cue.index))) return sentence;
  }
  return null;
}
export function endingWording(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  if (endingSentence(email)) return true;
  // the strict closure test, on the message without its conditional sentences ("If you are not selected, keep an eye on our jobs page")
  const unconditional = unquoted(`${email.subject}\n${email.bodyText}`).split(/(?<=[.!?])\s+/).filter((x) => !/^\s*(?:if|should|in the event|unless|in case)\b/i.test(x)).join(" ");
  return CLOSURE.test(unconditional) && closureFact({ subject: "", bodyText: unconditional });
}

/**
 * The message STATES the reader's own application: a receipt or confirmation ("we received your application", "thank you for applying", "your application has been submitted / is under review",
 * "you have applied"), or a direct request of the reader inside their own process ("we would like to invite you to interview", "complete your assessment for your application"). A
 * deterministic fact about the text. It is what lets a model-found application enter the pipeline: evidence the student actually applied, not an alert, an event registration or marketing.
 * Does not hold for "apply now" calls to action, job recommendations or newsletters.
 */
const OWN_APPLICATION = new RegExp([
  String.raw`\b(?:thanks for your submission|your (?:[\w&'’.-]+ ){0,3}application is (?:now )?(?:complete|submitted|received|in)\b|thank you for taking the first step[^.]{0,60}\bby applying|you will hear back from us with a decision)`,
  String.raw`\b(?:we(?:'|’)?(?:ve| have)? (?:received|got) your (?:[\w&'’.-]+ ){0,5}application|(?:thank(?:s| you)|thanks) (?:you )?for (?:applying|your application|submitting your application|your interest in applying)|your (?:[\w&'’.-]+ ){0,5}application (?:has been|was|is) (?:successfully )?(?:received|submitted|complete[d]?|under review|being reviewed|in review)|(?:you(?:'|’)?ve|you have) (?:successfully )?(?:applied|submitted your application)|application (?:received|confirmation|submitted)|(?:we(?:'|’)re|we are) (?:currently )?reviewing your application|thank you for your application)`,
  String.raw`\b(?:we (?:would|'d) like to invite you to (?:interview|complete|schedule|take|a (?:call|chat|phone|video))|invite you to (?:interview|complete (?:an?|our|the) (?:online )?(?:assessment|test|challenge)|schedule (?:an?|your) (?:interview|call))|(?:schedule|book|confirm) your (?:interview|assessment)|your (?:interview|assessment|coding challenge) (?:is|has been) (?:scheduled|confirmed|booked)|(?:complete|finish) (?:your|the) (?:online )?(?:assessment|coding challenge) (?:for|to continue))`,
].join("|"), "i");
export function ownApplicationStatement(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const text = unquoted(`${email.subject}\n${email.bodyText}`);
  return OWN_APPLICATION.test(text);
}

// ------------------------------------------------------------------ marketing
const ALERT_SUBJECT = new RegExp([
  String.raw`\bjobs? (?:for you|you (?:might|may|could) (?:like|be interested)|picks?|alerts?|recommendations?|matching|digest|newsletter|near you)\b`,
  String.raw`\b(?:new|recommended|top|latest|trending|similar) (?:\d+ )?(?:[\w&-]+ ){0,3}jobs?\b`,
  String.raw`\b(?:job|career) (?:alert|picks?|digest|roundup|newsletter)\b`,
  String.raw`\b(?:jobs?|opportunities|internships?) (?:for you|picked for you|hand-?picked)\b`,
  String.raw`\b\d+ (?:new )?(?:jobs?|roles|openings) (?:for you|matching|near)\b`,
].join("|"), "i");
const BULK_MARKERS: Array<[string, RegExp]> = [
  ["unsubscribe", /\bunsubscribe\b|\bmanage (?:your )?(?:email )?(?:preferences|subscriptions?|notifications)\b|\bupdate (?:your )?(?:email )?preferences\b|\bopt[- ]out\b/i],
  ["postal", /\b\d{1,5}\s+[A-Z][\w .'-]{2,40}\s(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Suite|Ste\.?|Floor|Plaza|Way)\b[^\n]{0,60}\b[A-Z]{2}\s+\d{5}\b|\bP\.?O\.? Box \d+/],
  ["rights", /©|\ball rights reserved\b|\bprivacy policy\b[^\n]{0,60}\bterms\b/i],
  ["browser", /\bview (?:this )?(?:email )?in (?:your )?browser\b|\bhaving trouble viewing\b|\bforward to a friend\b/i],
  ["promo", /\b(?:free (?:portal|trial|webinar|ebook|guide|course|download)|limited[- ]time|sign up (?:now|today|for free)|register (?:now|today)|save \d+%|\d+% off|exclusive (?:offer|access)|giveaway|enroll (?:now|today))\b/i],
];
/** What makes a message personal: it speaks about the reader's own candidacy. */
const PERSONAL_ANCHOR = /\b(?:your (?:application|candidacy|interview|assessment|offer|resume|submission)|thank you for applying|thanks for applying|application (?:received|confirmation|status)|we (?:have )?received your|you applied|you(?:'ve| have) applied|invit(?:e|ation) (?:you )?to (?:interview|complete|schedule)|schedule your|your (?:upcoming )?interview)\b/i;

export type MarketingKind = "alert" | "bulk";
/** `alert`: a job-recommendation digest. `bulk`: unsubscribe + footer + promotion markers with no personal anchor. null: not marketing. */
export function marketingFact(email: Pick<RecruitingEmail, "subject" | "bodyText">): MarketingKind | null {
  const subject = email.subject ?? "";
  const body = email.bodyText ?? "";
  const personalSubject = PERSONAL_ANCHOR.test(subject);
  if (ALERT_SUBJECT.test(subject) && !personalSubject && !PERSONAL_ANCHOR.test(body.slice(0, 500))) return "alert";
  const hits = BULK_MARKERS.filter(([, re]) => re.test(body)).length;
  if (hits >= 3 && !personalSubject && !PERSONAL_ANCHOR.test(body.slice(0, 600))) return "bulk";
  if (hits >= 2 && BULK_MARKERS[4][1].test(body) && !personalSubject && !PERSONAL_ANCHOR.test(body)) return "bulk";
  return null;
}

// --------------------------------------------------------------- date binding
const OTHER_OFFER = /\b(?:other|another|competing|second|outside|alternative|existing|current|rival) (?:job |internship |full[- ]time )?offers?\b|\boffer (?:from|with|at) (?!us\b|our\b)[A-Z][\w&.-]+|\byour offer (?:from|with|at) [A-Z]/;
const PROMISE = /\b(?:i|we)(?:['’]ll| will| shall| plan to| expect to| hope to| should)\b[^.!?\n]{0,50}\b(?:update|get back|follow up|be in touch|share|let you know|reach out|circle back|have (?:an )?(?:answer|decision|news)|respond|come back)\b[^.!?\n]{0,70}\b(?:by|before|on|no later than|within)\b|\b(?:expect|look for) (?:an )?(?:update|decision|answer|response|news)[^.!?\n]{0,40}\b(?:by|before|on)\b/i;
const INVITES = /\b(?:invite you|schedule (?:your|a|an)|availability|pick a (?:time|slot)|book a (?:time|slot)|interview (?:on|at|is)|select a time|(?:coding|online|technical) (?:assessment|challenge|exercise))\b/i;
const CANCEL_SUBJECT = /^\s*(?:canceled|cancelled|cancelled event|canceled event|declined|annul[ée]|abgesagt|cancelad[oa])\s*(?:event)?\s*:/i;

export type DateBinding = { event: ExtractedEvent; note: string | null };

/** Re-attribute (or drop) the event's date from where it really came. Returns the event unchanged when nothing is wrong. */
export function bindDates(email: Pick<RecruitingEmail, "subject" | "bodyText" | "receivedAt">, event: ExtractedEvent): ExtractedEvent {
  if (event.outbound || !event.eventDate) return calendarCancellation(email, event);
  const full = `${email.subject}\n${email.bodyText}`;
  const mine = unquoted(full);
  const day = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  const target = day(event.eventDate);
  const near = (text: string) => findDateMentions(text, email.receivedAt).filter((m) => day(m.date) === target);
  const inMine = near(mine);
  const sets: Array<[string, boolean]> = [];
  // 1. the date only appears in quoted history
  if (inMine.length === 0 && near(full).length > 0) {
    sets.push(["date from quoted text (dropped)", true]);
  } else if (inMine.length > 0) {
    // 2. every mention in the sender's own text is about a competing offer, or is a promise to update
    const ctx = (index: number) => mine.slice(Math.max(0, index - 110), index + 60);
    if (inMine.every((m) => OTHER_OFFER.test(ctx(m.index)))) sets.push(["date of a competing offer (dropped)", true]);
    else if (inMine.every((m) => PROMISE.test(mine.slice(Math.max(0, m.index - 160), m.index + 40)))) sets.push(["date of a promised update (dropped)", true]);
  }
  let out = event;
  for (const [signal] of sets) out = { ...out, eventDate: null, eventDateHasTime: false, dateKind: null, signals: [...out.signals, signal] };
  if (sets.length > 0 && out.signals.includes("date of a promised update (dropped)") && (out.type === "interview_invite" || out.type === "assessment" || out.type === "interview_scheduled") && !INVITES.test(mine)) {
    out = { ...out, type: "status_update", signals: [...out.signals, "update promised (fact)"] };
  }
  return calendarCancellation(email, out);
}

/** "Canceled event: ..." is the end of an event, never an assessment or an interview. */
function calendarCancellation(email: Pick<RecruitingEmail, "subject" | "receivedAt">, event: ExtractedEvent): ExtractedEvent {
  if (event.outbound || !CANCEL_SUBJECT.test(email.subject ?? "")) return event;
  const cancelled = event.eventDate ? `cancelled:${event.eventDate.toISOString().slice(0, 10)}` : "cancelled:";
  return { ...event, type: "status_update", eventDate: null, eventDateHasTime: false, dateKind: null, signals: [...event.signals, "cancellation (fact)", cancelled] };
}


/**
 * The employer ends THIS candidate's application in plain voice, about their own application: an ending sentence (see endingSentence) that is not hypothetical, in employer voice, in a message that
 * speaks of the reader's own application, interview or candidacy (in the sentence or the opening of the message). Strong enough to settle an application; wording families, not a template.
 */
const OWN_REF = /\b(?:your (?:\w+ ){0,2}(?:application|candidacy|candidature|interest|interview|resume|profile)|you (?:applied|have applied|interviewed|took the time to apply)|(?:apply|applying|applied) (?:for|to)|for (?:the|our) [\w ,&()/-]{3,60}(?:position|role|internship|program|fellowship)|interviewing with)/i;
export function ownEnding(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const sentence = endingSentence(email);
  if (!sentence || FIRST_PERSON.test(sentence) || !EMPLOYER_VOICE.test(sentence)) return false; // a sentence with no we / you is about someone else ("WEB101 applicants are not eligible")
  const lead = unquoted(`${email.subject}\n${email.bodyText}`).slice(0, 900);
  // the outcome of an event REGISTRATION (a session, a webinar, a workshop, a hub) is not the outcome of an application
  if (/\b(?:registration|register(?:ed)?|webinar|workshop|conference|summit|hackathon|career fair|info(?:rmation)? session)\b/i.test(`${email.subject} ${sentence}`) && !/\b(?:application|candidacy|position|role|internship|externship|fellowship|program(?:me)?)\b/i.test(`${email.subject} ${sentence}`)) return false;
  return OWN_REF.test(sentence) || OWN_REF.test(lead);
}

/** The employer ACKNOWLEDGES that the candidate withdrew or cannot take part ("we understand why you are unable to join us", "we have received your withdrawal"). */
const WITHDRAWAL_ACK = /\b(?:(?:understand|sorry to hear)(?: why| that)? you(?:'re|’re| are| will be|'ll be|’ll be| cannot| can(?:no|')t| won't be| won’t be)? ?(?:not able to|unable to|able to not|cannot|can't|won't be able to) (?:join|attend|participate|accept|continue|take part)|(?:accept|acknowledge|received|confirm)\w*[^.!?]{0,30}your (?:withdrawal|decision to withdraw|request to withdraw)|(?:we have|we've|we’ve|i have|i’ve|i've) withdrawn your (?:application|candidacy)|your (?:application|candidacy) (?:has|have) been withdrawn)\b/i;
export function withdrawalAcknowledged(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  // sentence by sentence, never a consequence or a condition ("failing to attend will result in the withdrawal of your application")
  const COND = /\b(?:if|will|would|may|might|could|should|failing|unless|in case|when|must|cannot be)\b/i;
  return sentencesOf(email).filter((x) => !COND.test(x) || /understand|sorry to hear/i.test(x)).some((x) => WITHDRAWAL_ACK.test(x));
}


/**
 * The position a message NAMES in its own words ("…selected to move forward for the Internship - Digital, North America position", "your application for Software Engineer Intern (Summer 2027)"),
 * or null. Identity evidence for a message whose stored role is generic. Wording families, current text only.
 */
const NAMED_ROLE = [
  /\b(?:spot|seat|place) (?:has (?:just )?opened (?:up )?)?in (?:the |our )?\*?([A-Z][\w &'’-]{6,80}?\b(?:Program|Programme|Fellowship|Academy|Cohort|Bootcamp|Institute|Course))\b/,
  /\b(?:[Ff]ollow-?[Uu]p|[Uu]pdate|[Qq]uestion|[Ii]nquiry|[Ss]tatus)s? (?:on|about|regarding|for) (?:my |your |the )?([A-Z0-9][\w ,&/()'’+.-]{6,80}?) (?:[Aa]pplication|[Cc]andidacy)\b/,
  /\b(?:selected|invited|accepted|admitted|chosen) (?:to|for|into) (?:attend |join |participate in |be part of )?(?:the |our )?([A-Z][^.!?]{6,80}?\b(?:Accelerator|Program|Programme|Lab|Fellowship|Academy|Series|Cohort|Institute|Bootcamp|Workshop|Summit|Course)\b)/,
  /\b(?:join|joining|accepted (?:in|into|to)|admitted (?:in|into|to)|invited to) (?:our |the )?([A-Z][^.]{6,90}?\b(?:Program|Programme|Fellowship|Academy|Cohort|Bootcamp|Institute|Course|Workshop|Certificate)\b[^.,(]{0,30}?)(?=[.,(]| delivered| via|$)/,
  /\b(?:for|to|regarding) (?:the |our )?([A-Z0-9][\w ,&/()'’+.-]{6,100}?) (?:position|role|opportunity)\b/,
  /\b(?:your )?application (?:for|to) (?:the )?([A-Z0-9][\w ,&/()'’+.-]{6,100}?)(?: position| role|\.|,| at | with |\n|$)/,
  /\bapply(?:ing)? (?:for|to) (?:the )?([A-Z0-9][\w ,&/()'’+.-]{6,100}?)(?: position| role|\.|,| at |\n|$)/,
];
const NOT_A_ROLE = /^(?:the |our |this |that |your |a |an |next |another |other |any |each |more |new |similar |future |exciting |great |various |these |those )|\b(?:next step|next round|team|company|process|openings|thank you|thanks|dear|hello|hi)\b/i;
export function namedRole(email: Pick<RecruitingEmail, "subject" | "bodyText">): string | null {
  for (const sentence of sentencesOf(email)) for (const re of NAMED_ROLE) {
    const m = re.exec(sentence);
    const role = m?.[1]?.trim().replace(/[ ,.-]+$/, "").replace(/\s+(?:and|which|that|will|has|is|was|where|when|so)\b.*$/i, "").trim();
    if (role && role.length >= 8 && role.length <= 100 && !/[.!?]\s/.test(role) && (role.match(/\(/g)?.length ?? 0) === (role.match(/\)/g)?.length ?? 0) && !NOT_A_ROLE.test(role) && /\b(?:intern(?:ship)?|engineer|developer|analyst|scientist|designer|manager|associate|fellow|apprentice|co-?op|extern(?:ship)?|researcher|program|programme|academy|accelerator|institute|bootcamp|cohort|course|ux|design|data|software|product)\b/i.test(role)) return role;
  }
  return null;
}


/**
 * A mass-mailing CAMPAIGN: sent through a bulk-mail platform (a "view this email in your browser" header or tracked list-manage / mailchi / constant-contact / hubspot links) AND built around a call to
 * apply ("CLICK HERE TO APPLY", "Apply Here"), with no statement about the reader's own application. An invitation to apply is not an application; a host that announces partner opportunities weekly
 * (a programme operator, a job board) is not an employer the reader applied to. Wording and infrastructure families, not any sender's template.
 */
const BULK_PLATFORM = /(?:utm_source=email%20campaign|utm_medium=xxxxx|list-manage\.com|mailchi\.mp|campaign-archive\.com|mcusercontent\.com|constantcontact\.com|hubspotlinks\.com|view this email in your browser|view in browser)/i;
const APPLY_CTA = /\b(?:(?:invite|inviting|encourage|invited) you to apply|(?:we(?:'|’)re|we are) opening applications|click here to apply|apply here|apply now|learn more and apply|apply today|sign up (?:now|here)|applications? (?:are )?(?:now )?open)\b/i;
// a SUBJECT that is itself a call to apply to something the reader has not applied to ("Apply by June 6: ...", "4 Days Left: ...", "Applications Open: ...", "Last Call to Apply")
const CALL_TO_APPLY_SUBJECT = /^\W*(?:(?:re|fwd?)\s*:\s*)*(?:reminder\s*:\s*)?(?:apply (?:by|now|today|here)|applications? (?:open|close|due|closing)|last call to apply|\d+ days? left|final (?:call|days?)|invitation to apply|invites? you to apply|now accepting applications)\b|\b\d+ days? left\b|\b(?:internships?|roles?|positions?) (?:are )?(?:now )?(?:live|open)\b|\b(?:applications?|internships?) opening soon\b|\bdon(?:'|’)?t miss out\b|\bis hiring\b|\bnew roles? at\b/i;
export function campaignFact(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const text = unquoted(`${email.subject}\n${email.bodyText}`);
  return ((BULK_PLATFORM.test(text) && APPLY_CTA.test(text)) || CALL_TO_APPLY_SUBJECT.test(email.subject)) && !ownApplicationStatement(email);
}


/**
 * The employer a message NAMES in its own words, for a message whose stored company is unknown: "Thank you for your interest in The Coca-Cola Company", "your application to Texas Instruments".
 * A capitalised name after an own-application phrase; names that are really titles, programmes or generic nouns are rejected. Wording families, not any employer.
 */
const EMPLOYER_NAMED = /\b(?:(?:thank you for|thanks for) your (?:interest|application) (?:in|to|with|at)|(?:interest|applying|applied|application) (?:to|at|with|in)|position (?:at|with)|opportunity (?:at|with)|career at|(?:role|position|internship|externship) with|status (?:on|for) (?:your application )?with) (?:the )?([A-Z][\w&'’-]*(?: (?:[A-Z][\w&'’-]*|of|and|&|the|de|la)){0,4}?)(?=[.,!:;)]|\s+(?:for|as|and|we|is|has|was|will|team|role|position|opportunity|internship|program)\b|$)/;
const NOT_AN_EMPLOYER = /\b(?:ziprecruiter|linkedin|indeed|glassdoor|handshake|ripplematch|forage|workday|greenhouse|lever|smartrecruiters|icims|taleo|ashby|hirevue|codesignal|hackerrank|monster|simplyhired|wellfound|builtin|intern(?:ship)?|engineer(?:ing)?|developer|analyst|manager|position|role|program(?:me)?|fellowship|opportunit(?:y|ies)|application|team|career|careers|job|jobs|company|us|our|your|this|that|summer|spring|fall|winter)\b/i;
/** The sentences of what THIS message says, with soft-wrapped lines joined (a single newline inside a sentence is a wrap, not a boundary); the subject is its own sentence. */
function sentencesOf(email: Pick<RecruitingEmail, "subject" | "bodyText">): string[] {
  const body = unquoted(email.bodyText).replace(/\r/g, "").replace(/(?<![.!?:\n])\n(?![\n\-*•])/g, " ");
  return [email.subject, ...body.split(/(?<=[.!?])\s+|\n+/)].map((x) => x.replace(/[*_]{1,3}/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}
export function employerNamed(email: Pick<RecruitingEmail, "subject" | "bodyText">): string | null {
  // sentence by sentence (a subject and a greeting are not one sentence: "...interest in Meta" + "Hi Afrane" must not become "Meta Hi Afrane")
  for (const sentence of sentencesOf(email)) {
    const m = EMPLOYER_NAMED.exec(sentence);
    const name = m?.[1]?.trim().replace(/[ ,.-]+$/, "");
    if (!name || name.length < 3 || name.length > 50) continue;
    const core = name.replace(/^The /, "").replace(/\b(?:Company|Inc\.?|LLC|Corporation|Corp\.?|Ltd\.?|Group)\b/g, "").trim();
    if (core && !NOT_AN_EMPLOYER.test(core) && !/\b(?:Hi|Hello|Dear|Hey)\b/.test(name)) return name;
  }
  return null;
}

/**
 * Where a PROGRAMME message sits in its own lifecycle, when the source says so: invited (an invitation to join), accepted (accepted / selected into it), enrolled (welcome / confirmed participation /
 * a session, assignment or section of it), completed (completion certificate). Wording families; the product uses it to keep programme evidence in the programme's journey.
 */
const P_COMPLETED = /\b(?:thank you for (?:an? )?(?:incredible|amazing|wonderful|great|fantastic) (?:week|program(?:me)?|experience|cohort|externship)|thank you for (?:attending|participating in|being (?:a )?part of) (?:the |our |this )?[\w &'’-]{0,40}(?:externship|program(?:me)?|cohort|bootcamp|academy)\b|certificate of (?:completion|participation)|congratulations on your (?:successful )?completion of|congratulations on (?:completing|finishing|graduating)|you(?:'|’)ve (?:successfully )?(?:completed|graduated)|you have (?:successfully )?completed|completion certificate)\b/i;
const P_ACCEPTED = /\b(?:you(?:'|’)re (?:officially )?in (?:the )?[A-Z][\w &'’-]{2,50}\b(?:Academy|Program|Programme|Cohort|Fellowship|Bootcamp|Institute|Course)\b|your (?:\w+ ){0,3}spot is confirmed|formal(?:ly)? invit(?:ation|ed)|we (?:reviewed|received) [^.]{0,40}applications and[^.]{0,60}(?:impressed|pleased|excited)|you(?:'|’)ve been (?:accepted|selected|admitted)|you have been (?:accepted|selected|admitted)|congratulations[^.]{0,60}(?:accepted|selected|admitted)|formally invited|we are pleased to (?:accept|admit))\b/i;
const P_INVITED = /\b(?:(?:thrilled|pleased|excited) to invite you to (?:continue|join|take part)|invitation to join|invited to join|invite you to join|you(?:'|’)re invited to (?:join|apply))\b/i;
const P_ENROLLED = /\b(?:welcome to|section reminder|first section|assignment graded|deep work session|kick-?off|cohort (?:call|session)|your (?:cohort|section|session))\b/i;
/** The programme itself ended the person's participation ("Removal from your section", "your admission has been withdrawn"): past tense or a notice headline, never a warning. */
const P_REMOVED = /(?:^\W*removal from your\b|\b(?:you(?:'|’)?ve|you have|you were|you are) (?:been )?(?:removed|dropped|dismissed) from\b|\byour (?:\w+ ){0,3}(?:admission|enrollment|enrolment|acceptance|spot|place|participation)(?: [^.]{0,60})? (?:has been|was|have been) (?:withdrawn|revoked|rescinded|cancell?ed|removed)\b)/i;
/** A scholarship, grant or fund tells the person the award is theirs (approved, awarded, payment on its way or sent). */
const P_AWARDED = /(?:\byour (?:\w+ ){0,3}application(?: for [^.]{0,60})? has been approved\b|\bcongratulations\b[^.]{0,100}\b(?:approved|awarded|selected as an? (?:recipient|awardee))\b|\byour payment (?:has been sent|is being processed)\b|\bpayment has been (?:sent|issued)\b|\bprompt acceptance of the award\b|\byour award is currently being processed\b)/i;
const PROCESS_ROLE = /\b(?:interview|assessment|internship|software engineer|position|job offer|hiring)\b/i;
export type ProgramStage = "invited" | "accepted" | "enrolled" | "completed" | "removed" | "awarded";
export function programStage(email: Pick<RecruitingEmail, "subject" | "bodyText">): ProgramStage | null {
  // sentence by sentence, never a condition ("in the case you have been selected to move forward" is not an acceptance)
  const COND = /\b(?:if|in the case|in case|should|whether|unless|when)\b/i;
  const sentences = sentencesOf({ subject: email.subject, bodyText: email.bodyText.slice(0, 2200) }).filter((x) => !COND.test(x));
  const any = (re: RegExp) => sentences.some((x) => re.test(x));
  if (any(P_REMOVED)) return "removed";
  if (any(P_AWARDED) && !PROCESS_ROLE.test(`${email.subject} ${sentences.join(" ")}`)) return "awarded";
  // completion of the PROGRAMME itself: not an earlier level, an onboarding step, a form, or the reminder/invitation that mentions what the person already did
  const NOT_THE_END = /\b(?:onboarding|application|form|profile|registration|survey|level|step|prerequisite|reminder|section|invit\w*|before|prior)\b/i;
  if (sentences.some((x) => P_COMPLETED.test(x) && !NOT_THE_END.test(`${email.subject} ${x}`))) return "completed";
  // finishing a level and being invited to the next is advancement inside the programme, not its end
  if (any(P_COMPLETED) && (any(P_INVITED) || any(P_ACCEPTED))) return "accepted";
  if (any(P_ACCEPTED)) return "accepted";
  if (any(P_INVITED)) return "invited";
  if (any(P_ENROLLED)) return "enrolled";
  return null;
}

/**
 * The reader's OWN reply declines or withdraws from the opportunity ("I have already made a commitment ... so I am not in a position to pursue another internship", "I would like to withdraw").
 * First person, own words, sentence by sentence; a question or a condition is not a decision. Used only on outbound mail.
 */
const DECLINE = /\b(?:i(?:'|’)?(?:ve| have) (?:already )?(?:made a commitment|committed to|accepted (?:another|an|a)\b)|i(?:'m| am) (?:not|no longer) (?:currently )?(?:in a position|able|available|interested|looking) (?:to )?(?:pursue|continue|move forward|take|accept|proceed|for)|i(?:'d| would) (?:like|need|have) to (?:respectfully )?(?:withdraw|decline)|i (?:must|have to|need to|will have to|regret to) (?:respectfully )?(?:withdraw|decline)|(?:please )?(?:withdraw|remove) my (?:application|candidacy)|i (?:am|'m) withdrawing|i (?:have )?decided (?:not to|to (?:decline|withdraw|pursue (?:another|other)))|i(?:'|’)?ll (?:have to )?(?:decline|pass))\b/i;
export function studentDeclines(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const COND = /\b(?:if|whether|should|unless|could you|can you|would you)\b/i;
  return sentencesOf({ subject: "", bodyText: email.bodyText.slice(0, 1500) }).filter((x) => !COND.test(x) || /^i\b/i.test(x.trim())).some((x) => DECLINE.test(x) && !/\?\s*$/.test(x));
}

/**
 * Conversational responsibility: the sender says THEY will act next ("I will look for a time and send you an update", "we'll be in touch") and asks the reader for nothing. The message is then not a request
 * to the reader (an invitation to book, a question to answer): the ball is with the sender. Sentence by sentence on this message's own words; any ask of the reader in the same message cancels it.
 */
const THEY_WILL = /\b(?:i|we)(?:'|’)?(?:ll| will| am going to| are going to)\s+(?:\w+\s+){0,3}(?:send|get back|circle back|follow up|reach out|let you know|be in touch|confirm|update|share|look (?:for|into|at)|find|check|coordinate|schedule|set up|arrange|propose)\b|\b(?:the team|our team|recruiting|the recruiter) will (?:\w+\s+){0,3}(?:be in touch|get back|follow up|reach out|send|update|confirm|schedule|contact)\b/i;
const ASKS_YOU = /\?|\b(?:please (?:\w+\s+){0,2}(?:reply|respond|send|share|confirm|provide|complete|schedule|book|select|choose|pick|let me know|let us know)|let (?:me|us) know|could you|can you|would you|will you|reply (?:to this|with)|use the link|click (?:the|this) link|sign up|select a (?:time|slot)|book a (?:time|slot)|action required|what(?:'|’)?s your availability|are you available)\b/i;
export function awaitingThem(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const own = sentencesOf({ subject: "", bodyText: email.bodyText.slice(0, 1200) });
  if (own.length === 0 || own.length > 14) return false;
  return own.some((x) => THEY_WILL.test(x)) && !own.some((x) => ASKS_YOU.test(x));
}
