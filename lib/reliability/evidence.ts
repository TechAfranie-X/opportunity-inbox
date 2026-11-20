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

export function closureFact(email: Pick<RecruitingEmail, "subject" | "bodyText">): boolean {
  const text = unquoted(`${email.subject}\n${email.bodyText}`);
  const closure = CLOSURE.exec(text);
  if (!closure || CLOSURE_NOT_ABOUT_YOU.test(text)) return false;
  // a positive anchor ("congratulations", "next round", "invite you") BEFORE the closure phrase means the closure words belong to a conditional or a different matter
  const anchor = OFFER_OR_NEXT.exec(text.slice(0, closure.index));
  return !anchor;
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
