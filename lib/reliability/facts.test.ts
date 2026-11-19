import assert from "node:assert/strict";
import test from "node:test";
import type { RecruitingEmail } from "../recruiting/types.ts";
import { isNearMiss } from "./flags.ts";
import { readMail } from "./assess.ts";
import { bodyAct, explicitOffer } from "./facts.ts";

// Synthetic text, fictional employers. Negative cases matter as much as positive ones: a fact must not fire on look-alike wording.
const mail = (id: string, from: string, subject: string, body: string, at: string): RecruitingEmail => ({ id, threadId: id, from, subject, bodyText: body, receivedAt: new Date(at), outbound: false });
const one = (m: RecruitingEmail) => readMail([m])[0];

test("a cancelled interview is not a scheduled interview", () => {
  const e = one(mail("c1", "Recruiting <recruiting@northpeak.example>", "Update on your upcoming interview", "Hi Sam, your upcoming interview on Friday at 2:00 PM has been cancelled. We appreciate your interest in Northpeak.", "2026-03-02T15:00:00Z"));
  assert.ok(e && e.type !== "interview_scheduled" && e.type !== "interview_invite", e?.type);
  assert.equal(e.eventDate, null);
});

test("a reschedule is not a cancellation, and a confirmed interview stays scheduled", () => {
  const re = one(mail("c2", "Recruiting <recruiting@northpeak.example>", "Your interview has been rescheduled", "Hi Sam, your interview on Friday was cancelled and rescheduled: your new time is Monday, March 9 at 3:00 PM ET.", "2026-03-02T15:00:00Z"));
  assert.ok(re && !re.signals.includes("cancellation (fact)"));
  const ok = one(mail("c3", "Priya <priya@northpeak.example>", "Your interview is confirmed", "Hi Sam, your interview is confirmed for Friday, March 6 at 12:00 PM ET. If you need to cancel, reply to this email.", "2026-03-02T15:00:00Z"));
  assert.equal(ok?.type, "interview_scheduled");
});

test("an explicit deadline beats a relative window, and a passed explicit deadline is kept", () => {
  const a = one(mail("d1", "Kestrel via CodeSignal <no-reply@codesignal.com>", "Reminder: Kestrel is waiting for your assessment", "Please complete your assessment within 7 days of your invitation. The deadline is October 8 at 11:59 PM PT.", "2026-10-02T14:00:00Z"));
  assert.equal(a?.eventDate?.toISOString().slice(0, 10), "2026-10-08");
  const b = one(mail("d2", "Prism via CodeSignal <no-reply@codesignal.com>", "Your Prism coding assessment", "Your coding assessment was due on September 28. Contact the recruiting team to request an extension.", "2026-09-30T10:00:00Z"));
  assert.equal(b?.eventDate?.toISOString().slice(0, 10), "2026-09-28");
});

test("a relative-only deadline is left to the reader", () => {
  const e = one(mail("d3", "Hiring <no-reply@us.greenhouse-mail.io>", "Complete your Arbor coding challenge", "Hi Sam, please complete the coding challenge within 5 days.", "2026-10-02T10:00:00Z"));
  assert.equal(e?.eventDate?.toISOString().slice(0, 10), "2026-10-07");
  assert.ok(!e?.signals.includes("explicit deadline (fact)"));
});

test("generic personality results with an upsell are not a candidacy; an employer's assessment with similar words is", () => {
  const generic = readMail([mail("g1", "Insight Profiles <no-reply@insightprofiles.example>", "Your DISC Assessment Results", "Thank you for completing the DISC assessment. Your personality style results are ready. Upgrade to the Pro report for $29 to unlock your full career profile.", "2026-07-20T12:00:00Z")]);
  assert.ok(generic.length === 0 || generic.every((e) => isNearMiss(e)));
  const real = readMail([mail("g2", "Talent <no-reply@us.greenhouse-mail.io>", "Next steps for your Arbor application", "Thanks for applying to the Software Engineer role at Arbor. Please complete the online assessment (a short personality and coding exercise) by October 20 to move to the next round.", "2026-10-10T10:00:00Z")]);
  assert.ok(real.length === 1 && !isNearMiss(real[0]));
});

test("review regressions: a past cancellation inside a live confirmation, and non-deadline dates", () => {
  const live = one(mail("r1", "Priya <priya@northpeak.example>", "Interview confirmed", "Hi Sam, your interview is confirmed. The previous meeting was cancelled, so see you Nov 20 at 2:00 PM.", "2026-11-10T15:00:00Z"));
  assert.equal(live?.type, "interview_scheduled");
  const a = one(mail("r2", "Kestrel via CodeSignal <no-reply@codesignal.com>", "Your Kestrel assessment", "Interviews take place before November 30. Please complete the assessment by December 5.", "2026-11-10T14:00:00Z"));
  assert.equal(a?.eventDate?.toISOString().slice(0, 10), "2026-12-05");
});

const offerBase = { id: "m1", threadId: "t1", to: "me@x.com", receivedAt: new Date("2026-10-23T17:56:00Z"), outbound: false, labels: [] };
const offerMail = (subject: string, bodyText: string, from = "Allstate <allstate@myworkday.com>") => ({ ...offerBase, subject, bodyText, from }) as unknown as RecruitingEmail;

test("explicitOffer reads an offer the reader rejected, with the role from the offer sentence", () => {
  const e = explicitOffer(offerMail("Congratulations on your job offer!", "Congratulations! We're thrilled to offer you the position of Allstate Technology Solutions Internship - Summer 2027 at Allstate Insurance Company. Log in."));
  assert.equal(e?.type, "offer");
  assert.equal(e?.role, "Allstate Technology Solutions Internship - Summer 2027");
});

test("explicitOffer ignores advice, non-employer senders and bodies without an offer", () => {
  assert.equal(explicitOffer(offerMail("Congratulations on your job offer? 5 negotiation tips", "offer")), null);
  assert.equal(explicitOffer(offerMail("Congratulations on your job offer!", "offer", "Friend <a@gmail.com>")), null);
  assert.equal(explicitOffer(offerMail("Congratulations on your job offer!", "nothing here")), null);
});

const act = (subject: string, body: string, from = "Jo Park <jo@brightwell.example>") => bodyAct(offerMail(subject, body, from));

test("bodyAct: a plain-subject message that makes an offer, invites or confirms an interview is read from the body", () => {
  assert.equal(act("Update", "Hi Mia, we'd like to offer you the Support Analyst position. Details follow.")?.type, "offer");
  assert.equal(act("Hello", "Hi Mia, we will move forward with scheduling a call about your application. Send me times.")?.type, "interview_invite");
  assert.equal(act("Re: hello", "Hi Mia, you're booked for Tuesday at 3pm for the interview. Zoom link below.")?.type, "interview_scheduled");
  assert.equal(act("Great news", "Hi Mia, we are pleased to extend an offer for the internship. Welcome aboard.")?.type, "offer");
});

test("bodyAct: marketing, sales, advice and other people's offers are not acts addressed to the reader", () => {
  assert.equal(act("Special", "Hi Mia, we'd like to offer you 20% off our interview coaching. Unsubscribe here.")?.type, undefined);
  assert.equal(act("Demo", "Hi Mia, can we schedule a call to show you our payroll software?")?.type, undefined, "no hiring context");
  assert.equal(act("Weekly", "Hello, five tips for when you receive a job offer. Manage your preferences or unsubscribe.")?.type, undefined);
  assert.equal(act("Hi", "We would like to offer you the position of reader of this newsletter")?.type, undefined, "no greeting or addressee");
  assert.equal(act("Lunch", "Hi Mia, can we schedule a chat about lunch on Friday?")?.type, undefined, "no hiring context");
});

test("bodyAct: a marketing footer does not veto an act that names the reader's own interview or application", () => {
  assert.equal(act("Hi", "Hi Mia, could you do a video interview with us next week about your application? Unsubscribe from marketing emails")?.type, "interview_invite");
});

const outMail = (id: string, thread: string, subject: string, body: string, at: string): RecruitingEmail => ({ id, threadId: thread, from: "me@school.example", subject, bodyText: body, receivedAt: new Date(at), outbound: true });
test("the student's own acceptance of an offer is a fact; a refusal or a different acceptance is not", async () => {
  const { studentAcceptance } = await import("./facts.ts");
  const base = { id: "o", gmailMessageId: "o", gmailThreadId: "t", occurredAt: new Date(), outbound: true, senderName: "", senderDomain: "", subject: "", type: "user_reply", company: null, role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.5, reviewReasons: [], signals: [] } as never;
  for (const body of ["Hi Owen, I'm thrilled to accept. Thank you!", "Bonjour, j'accepte avec grand plaisir l'offre.", "Hola, acepto la oferta con mucho gusto.", "Sehr geehrte Damen, ich nehme das Stipendium sehr gerne an.", "Olá, aceito a proposta, obrigada!"]) {
    assert.ok(studentAcceptance(outMail("a", "t", "Re: Offer", body, "2026-01-02T00:00:00Z"), base).signals.includes("student:accepts"), body);
  }
  for (const body of ["Thank you, but I must decline the offer.", "Unfortunately I am unable to accept at this time.", "Lo siento, no puedo aceptar la oferta.", "Thanks, I will send the documents tomorrow."]) {
    assert.ok(!studentAcceptance(outMail("b", "t", "Re: Offer", body, "2026-01-02T00:00:00Z"), base).signals.includes("student:accepts"), body);
  }
});
