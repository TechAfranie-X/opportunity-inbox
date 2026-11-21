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

const QUOTE_START = [
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
  return OWN_REF.test(sentence) || OWN_REF.test(lead);
}

/** The employer ACKNOWLEDGES that the candidate withdrew or cannot take part ("we understand why you are unable to join us", "we have received your withdrawal"). */
const WITHDRAWAL_ACK = /\b(?:(?:understand|sorry to hear)(?: why| that)? you(?:'re|’re| are| will be|'ll be|’ll be| cannot| can(?:no|')t| won't be| won’t be)? ?(?:not able to|unable to|able to not|cannot|can't|won't be able to) (?:join|attend|participate|accept|continue|take part)|(?:accept|acknowledge|received|confirm)\w*[^.!?]{0,30}your (?:withdrawal|decision to withdraw|request to withdraw)|(?:we have|we've|we’ve|i have|i’ve|i've) withdrawn your (?:application|candidacy)|withdrawal of your (?:application|candidacy)|your (?:application|candidacy) (?:has|have) been withdrawn)\b/i;
export function withdrawalAcknowledged(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  return WITHDRAWAL_ACK.test(unquoted(`${email.subject}\n${email.bodyText}`));
}


/**
 * The position a message NAMES in its own words ("…selected to move forward for the Internship - Digital, North America position", "your application for Software Engineer Intern (Summer 2027)"),
 * or null. Identity evidence for a message whose stored role is generic. Wording families, current text only.
 */
const NAMED_ROLE = [
  /\b(?:for|to|regarding) (?:the |our )?([A-Z0-9][\w ,&/()'’+.-]{6,80}?) (?:position|role|opportunity)\b/,
  /\b(?:your )?application (?:for|to) (?:the )?([A-Z0-9][\w ,&/()'’+.-]{6,80}?)(?: position| role|\.|,| at | with |\n|$)/,
  /\bapply(?:ing)? (?:for|to) (?:the )?([A-Z0-9][\w ,&/()'’+.-]{6,80}?)(?: position| role|\.|,| at |\n|$)/,
];
const NOT_A_ROLE = /^(?:the |our |this |that |your |a |an |next |another |other |any |each )|\b(?:next step|next round|team|company|process|opportunities|openings)\b/i;
export function namedRole(email: Pick<RecruitingEmail, "subject" | "bodyText">): string | null {
  const text = unquoted(`${email.subject}\n${email.bodyText}`).replace(/\r/g, "").replace(/\s+/g, " ");
  for (const re of NAMED_ROLE) {
    const m = re.exec(text);
    const role = m?.[1]?.trim().replace(/[ ,.-]+$/, "");
    if (role && role.length >= 8 && role.length <= 70 && !/[.!?]\s/.test(role) && !NOT_A_ROLE.test(role) && /\b(?:intern(?:ship)?|engineer|developer|analyst|scientist|designer|manager|associate|fellow|apprentice|co-?op|extern(?:ship)?|researcher|program|programme|ux|design|data|software|product)\b/i.test(role)) return role;
  }
  return null;
}
