import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractedEvent } from "../recruiting/types.ts";
import { applyTextFacts } from "./facts.ts";
import { bindDates, closureFact, marketingFact, unquoted } from "./evidence.ts";

// Fictional wording that mirrors the SHAPE of failures found by an independent audit (explicit rejections read as updates, job-alert digests read as applications, dates bound to
// the wrong thing). Every positive has a look-alike negative.
const RECEIVED = new Date("2026-11-10T15:00:00Z");
const ev = (type: string, extra: Partial<ExtractedEvent> = {}): ExtractedEvent => ({ gmailMessageId: "x", gmailThreadId: "t", occurredAt: RECEIVED, outbound: false, senderName: "", senderDomain: "", subject: "", type, company: "Orbis", role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.7, reviewReasons: [], signals: [], ...extra }) as ExtractedEvent;

test("explicit employer closure wording is a fact; job-posting, newsletter and 'next steps' wording is not", () => {
  const yes = [
    "Hi Sam, thank you for your interest. Your application is no longer under consideration for the Data Intern role.",
    "Hello Sam, we have decided not to move forward with your candidacy at this time.",
    "Dear Sam, unfortunately the position has been filled and we will not be proceeding with your application.",
    "Bonjour Sam, votre candidature n'a pas été retenue.",
    "Hallo Sam, leider können wir Ihre Bewerbung nicht weiter berücksichtigen. Wir wünschen alles Gute.",
    "Hola Sam, no continuaremos con su candidatura para el puesto.",
  ];
  for (const t of yes) assert.ok(closureFact({ subject: "Update", bodyText: t }), t);
  const no = [
    "This job is no longer accepting applications; see similar jobs below. Unsubscribe here.",
    "You will no longer receive emails from us. Unsubscribe confirmed.",
    "Congratulations Sam! You have been selected to advance to the next round. We will not be moving forward without your availability.",
    "Hi Sam, your application is under review and we are moving forward with scheduling. The role is open until filled.",
  ];
  for (const t of no) assert.ok(!closureFact({ subject: "Update", bodyText: t }), t);
});

test("closure turns a bare update into a rejection; an interview invitation stays", () => {
  const out = applyTextFacts({ subject: "Update on Your Job Application", bodyText: "Hi Sam, your application is no longer under consideration for this requisition.", receivedAt: RECEIVED }, ev("status_update"));
  assert.equal(out.type, "rejection");
  assert.ok(out.signals.includes("closure (fact)"));
  const invite = applyTextFacts({ subject: "Next steps", bodyText: "Hi Sam, we would like to invite you to interview. The earlier role is no longer under consideration, but this one is.", receivedAt: RECEIVED }, ev("interview_invite"));
  assert.equal(invite.type, "interview_invite");
});

test("job-alert digests and bulk promotions are marketing; a personal application message with a footer is not", () => {
  assert.equal(marketingFact({ subject: "Sports & Entertainment Jobs for You: New York Jets", bodyText: "Here are top job picks for you. Junior Software Developer. Unsubscribe | Manage preferences" }), "alert");
  assert.equal(marketingFact({ subject: "3 new jobs matching your search", bodyText: "Apply now. Unsubscribe." }), "alert");
  const promo = "Take our free DISC portal tour. Limited-time access. Register now. View this email in your browser. Unsubscribe. 100 Main Street, Austin, TX 78701. © Example Institute. All rights reserved.";
  assert.equal(marketingFact({ subject: "Understand your strengths", bodyText: promo }), "bulk");
  const personal = "Hi Sam, thanks for applying. We have received your application and will be in touch. Unsubscribe from job emails. 100 Main Street, Austin, TX 78701. © Example Corp.";
  assert.equal(marketingFact({ subject: "Your Cisco Journey Begins Here – Next Steps for Your Application", bodyText: personal }), null);
  assert.equal(marketingFact({ subject: "Application received for Data Intern", bodyText: personal }), null);
});

test("dates belong to what they are about: quoted history, a competing offer and a promised update are not an interview or assessment date", () => {
  const nov30 = new Date("2026-11-30T00:00:00Z");
  const quoted = bindDates({ subject: "Re: Next steps", bodyText: "Sounds good, thank you.\n\nOn Tue, Oct 27, 2026 at 9:00 AM Sam <sam@campus.example> wrote:\n> My other offer expires November 30, so I would love to finish by then.", receivedAt: RECEIVED }, ev("interview_invite", { eventDate: nov30 }));
  assert.equal(quoted.eventDate, null);
  assert.ok(quoted.signals.includes("date from quoted text (dropped)"));
  const other = bindDates({ subject: "Timing", bodyText: "I understand your other offer expires November 30, and we will do our best to match that timeline.", receivedAt: RECEIVED }, ev("interview_invite", { eventDate: nov30 }));
  assert.equal(other.eventDate, null);
  const promise = bindDates({ subject: "Re: Next steps", bodyText: "Thanks for your patience. I will get back to you with an update by November 25.", receivedAt: RECEIVED }, ev("interview_invite", { eventDate: new Date("2026-11-25T00:00:00Z") }));
  assert.equal(promise.eventDate, null);
  assert.equal(promise.type, "status_update");
  // look-alikes keep their date
  const real = bindDates({ subject: "Interview", bodyText: "We would like to invite you to interview on November 25 at 2:00 PM. Please confirm.", receivedAt: RECEIVED }, ev("interview_invite", { eventDate: new Date("2026-11-25T14:00:00Z"), eventDateHasTime: true }));
  assert.ok(real.eventDate);
  const own = bindDates({ subject: "Offer", bodyText: "We are pleased to extend an offer. Please respond by November 30. Competing offers are welcome to be discussed.", receivedAt: RECEIVED }, ev("offer", { eventDate: nov30 }));
  assert.ok(own.eventDate, "the employer's own offer deadline is kept");
  const promiseWithInvite = bindDates({ subject: "Interview", bodyText: "I will be in touch by November 25 once the panel is set. Please send your availability so we can schedule your interview.", receivedAt: RECEIVED }, ev("interview_invite", { eventDate: new Date("2026-11-25T00:00:00Z") }));
  assert.equal(promiseWithInvite.type, "interview_invite", "an invitation that also promises an update stays an invitation");
});

test("a cancelled calendar event is the end of an event, not an assessment", () => {
  const out = bindDates({ subject: "Canceled event: Your Upcoming Virtual Interviews with Orbis @ Tue Nov 17", bodyText: "This event has been canceled.", receivedAt: RECEIVED }, ev("assessment", { eventDate: new Date("2026-11-17T18:00:00Z") }));
  assert.equal(out.type, "status_update");
  assert.equal(out.eventDate, null);
  assert.ok(out.signals.includes("cancelled:2026-11-17"));
  const normal = bindDates({ subject: "Invitation: Your Upcoming Virtual Interviews with Orbis", bodyText: "x", receivedAt: RECEIVED }, ev("interview_scheduled", { eventDate: new Date("2026-11-17T18:00:00Z") }));
  assert.equal(normal.type, "interview_scheduled");
});

test("only the part the sender wrote now is read", () => {
  assert.equal(unquoted("Hello\n> old text\nmore"), "Hello\n");
  assert.equal(unquoted("Hello there"), "Hello there");
  assert.ok(!unquoted("Fresh.\n-----Original Message-----\nFrom: a\nold").includes("old"));
});

test("an invitation that mentions other candidates or fit is not a goodbye; real closure still raises the doubt", async () => {
  const { outcomeConflict } = await import("./assess.ts");
  const mail = (body: string) => ({ id: "m", threadId: "t", from: "Careers <careers@orbis.example>", subject: "Your coding challenge", bodyText: body, receivedAt: RECEIVED, outbound: false }) as never;
  const invite = "Hi Sam, this is the first step in our process. Please complete the challenge within 5 days. Successful candidates may progress to interviews; we also review many other candidates, so submit early.";
  assert.equal(outcomeConflict(mail(invite), ev("assessment")), null);
  const goodbye = "Hi Sam, thank you for your time. We have decided to go with other candidates and wish you the best in your search.";
  assert.ok(outcomeConflict(mail(goodbye), ev("status_update")));
  const mixed = "Hi Sam, your application is no longer under consideration. We encourage other candidates like you to apply again; next steps for future roles are on our site.";
  assert.ok(outcomeConflict(mail(mixed), ev("status_update")), "closure wording keeps the doubt even beside forward-looking words");
});
