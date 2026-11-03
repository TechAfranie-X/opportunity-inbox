import assert from "node:assert/strict";
import test from "node:test";
import { expandOrganization, inferRole } from "./company.ts";
import { resolveBatch, resolveCompany } from "./entity/resolve.ts";
import { extractAll, extractWithReason } from "./extract.ts";
import { isAutoReply, isNegativeOutcome } from "./signals.ts";
import type { RecruitingEmail } from "./types.ts";

// Synthetic mail only. Each test states the general property it protects; none is copied from a mailbox.
const mail = (o: Partial<RecruitingEmail>): RecruitingEmail => ({ id: "m", threadId: "t", from: "Acme Recruiting <jobs@acme.com>", subject: "", bodyText: "", receivedAt: new Date("2026-03-01T12:00:00Z"), outbound: false, ...o });
const type = (o: Partial<RecruitingEmail>) => extractWithReason(mail(o));

test("a rejection is a structure (negation × progression in a decision about the candidacy), not a phrase list", () => {
  const wordings = [
    "We have decided not to move forward with your candidacy at this time.",
    "Unfortunately, we are not able to extend an invitation to you this year.",
    "After careful consideration, we will not be advancing your application.",
    "We are unable to proceed with your application.",
    "We can't continue with your candidacy.",
  ];
  for (const w of wordings) assert.equal(isNegativeOutcome(w), true, w);
  const notDecisions = [
    "If we are unable to move forward we will let you know.",
    "You cannot proceed until you verify your email address.",
    "We can't interview you Tuesday; is another time available?",
    "Do not hesitate to move forward and apply again.",
  ];
  for (const w of notDecisions) assert.equal(isNegativeOutcome(w), false, w);
});

test("a polite opener never outranks a rejection stated later in the message", () => {
  for (const body of [
    "Thank you for your interest in Acme. After reviewing your application for the Analyst role, we've decided not to move forward with your candidacy.",
    "Thank you so much for applying. While we're not able to extend an invitation to you for the Analyst program this year, we encourage you to apply again.",
  ]) {
    const r = type({ subject: "Update from Acme", bodyText: body });
    assert.equal(r.event?.type, "rejection", body);
  }
});

test("automatic replies are context, never lifecycle events, whatever recruiting words they quote", () => {
  assert.equal(isAutoReply("Jo @ Acme - OOO (10/2-10/13)", ""), true);
  const body = "Hello, thank you for your email! I am currently out of the office until the 14th. If you recently applied to an early career role, we are unable to expedite the interview process.";
  assert.equal(isAutoReply("Re: Thank you", body), true);
  assert.equal(type({ subject: "Re: Thank you", bodyText: body }).reason, "auto_reply");
  // a person mentioning absence in a real scheduling message is not an auto-reply
  assert.equal(isAutoReply("Re: Interview", "Hi! I will be out of the office Friday, so can we move your interview to Thursday at 2pm?"), false);
});

test("an event registration or course promotion is not a hiring process unless a candidacy is attached", () => {
  assert.equal(type({ subject: "Registration update", bodyText: "Thank you for your interest in Acme. We have received your registration for the 2026 Code Hackathon. This does not confirm your attendance." }).reason, "non_hiring_event");
  assert.equal(type({ subject: "Enroll before the deadline", bodyText: "Cohorts are filling. Pick a time to schedule an enrollment call with an advisor." }).reason, "non_hiring_event");
  // the same words with a real candidacy stay recruiting
  assert.equal(type({ subject: "Thank you for applying", bodyText: "We received your application for the Software Engineer Intern position. Registration for the optional info session is open." }).event?.type, "applied");
});

test("weak hiring vocabulary without any hiring process behind it is not recruiting", () => {
  const r = type({ from: "Marketplace <no-reply@shop.example>", subject: "New message", bodyText: "Hello, I sent the item last week. Can you pick a time to talk about the package? Thank you for your interest." });
  assert.equal(r.event, null);
});

test("a domain is an identity key: the fuller name the message uses wins when the domain abbreviates it or is a unit of it", () => {
  assert.equal(expandOrganization("tmcf.org", "Join the Thurgood Marshall College Fund Leadership Program. Thurgood Marshall College Fund"), "Thurgood Marshall College Fund");
  assert.match(expandOrganization("slac.stanford.edu", "Sincerely, Talent Acquisition SLAC National Accelerator Laboratory")!, /^SLAC National Accelerator Laboratory$/);
  assert.equal(expandOrganization("acme.com", "Hello Wide World, nothing to see"), null);
  assert.equal(expandOrganization("mail.example.com", "Contact Mail Team Lab"), null); // generic labels are not identities
});

test("a sender block asserted but never named in the message is weaker than a name the message confirms", () => {
  const res = resolveCompany({
    from: "Globex Growth Equity <invites@assess.vendor-corp.com>",
    subject: "Recruiting from Globex Growth Equity invites you to take the Growth Equity Internship assessment",
    body: "Hello, please complete the assessment. Support: help@assess.vendor-corp.com. © 2025 AssessCo",
  });
  assert.equal(res.entity?.name, "Globex Growth Equity");
});

test("the intermediary's own brand is not the hiring organisation by text alone", () => {
  const res = resolveCompany({ from: "CodeSignal <no-reply@codesignal.com>", subject: "Reminder: RippleMatch assessment invitation", body: "You have been invited by RippleMatch to take the RippleMatch Assessment. Complete it before it expires." });
  assert.equal(res.entity, null);
});

test("a programme descriptor attached to a sender-confirmed employer name is not part of the employer", () => {
  const e = type({ from: "Pat Doe <pat.doe@initech.com>", subject: "Welcome to Initech’s Innovate Boldly Externship", bodyText: "Congratulations! You have been selected for the externship. Your offer letter is attached." }).event!;
  assert.equal(e.company, "Initech");
});

test("a vendor-assigned slug counts only if it is a name: shared infrastructure hostnames never identify an employer", () => {
  const res = resolveCompany({ from: "Talent <talent@umbrella.org>", subject: "Complete your application", body: "Umbrella Foundation. Track it at https://tracking.icims.com/f/a/xyz and https://tracking.icims.com/z" });
  assert.notEqual(res.entity?.name.toLowerCase(), "tracking");
});

test("vendor learning ignores noisy body-only names, so one calendar invite cannot turn an employer domain into a vendor", () => {
  const items = [
    { id: "a", threadId: "1", from: "Lee <lee@hooli.io>", subject: "Interview with Hooli", body: "We would like to interview you for the Engineer role at Hooli." },
    { id: "b", threadId: "2", from: "Lee <lee@hooli.io>", subject: "Invitation: Interview Confirmation", body: "Thursday 1:30pm. Join with Google Calendar. This is a Zoom meeting." },
    { id: "c", threadId: "3", from: "Kim <kim@hooli.io>", subject: "Your application", body: "Thanks for applying to Hooli for the Analyst position." },
  ];
  const res = resolveBatch(items);
  assert.equal(res.get("b")!.entity?.name, "Hooli");
});

test("later mail from a named person who already wrote about a candidacy is linked; bulk and promotional mail is not", () => {
  const offer = mail({ id: "1", threadId: "t1", from: "Ana Ruiz <ana.ruiz@initech.com>", subject: "Your offer letter", bodyText: "We are pleased to extend an offer for the Engineering Intern position. Offer letter attached.", receivedAt: new Date("2026-03-01T12:00:00Z") });
  const logistics = mail({ id: "2", threadId: "t2", from: "Ana Ruiz <ana.ruiz@initech.com>", subject: "Flight question", bodyText: "Hi! Which airport will you depart from? Thanks!", receivedAt: new Date("2026-03-05T12:00:00Z") });
  const bulk = mail({ id: "3", threadId: "t3", from: "Initech News <news@initech.com>", subject: "Our spring newsletter", bodyText: "Which products did you enjoy? Thanks!", receivedAt: new Date("2026-03-06T12:00:00Z") });
  const promo = mail({ id: "4", threadId: "t4", from: "Ana Ruiz <ana.ruiz@initech.com>", subject: "Save the date: webinar", bodyText: "Join our webinar next week!", receivedAt: new Date("2026-03-07T12:00:00Z") });
  const events = extractAll([offer, logistics, bulk, promo]);
  const linked = events.find((e) => e.gmailMessageId === "2");
  assert.ok(linked);
  assert.equal(linked.type, "status_update");
  assert.deepEqual(linked.signals, ["known-contact-continuity"]);
  assert.ok(linked.fieldConfidence!.type < 0.45, "contact-only continuity must be flagged for review");
  assert.ok(!events.some((e) => e.gmailMessageId === "3" || e.gmailMessageId === "4"));
});

test("an automatic reply in a known thread stays out of the lifecycle", () => {
  const first = mail({ id: "1", threadId: "t1", from: "Ana Ruiz <ana.ruiz@initech.com>", subject: "Interview invitation", bodyText: "We would like to interview you for the Engineering Intern role. Please select a time." });
  const auto = mail({ id: "2", threadId: "t1", from: "Ana Ruiz <ana.ruiz@initech.com>", subject: "Automatic reply: Interview invitation", bodyText: "I am out of the office." });
  assert.deepEqual(extractAll([first, auto]).map((e) => e.gmailMessageId), ["1"]);
});

test("an opportunity with no job title is named by its programme or labelled field", () => {
  assert.equal(inferRole("Welcome", "Requisition: 2026 | Americas | Summer Analyst\nThanks"), "2026 | Americas | Summer Analyst");
  assert.equal(inferRole("Selected", "We selected you for the Innovate Boldly Externship Program in May."), "Innovate Boldly Externship Program");
  assert.equal(inferRole("Update", "Thank you for your interest in joining us for BrickFest 2026 in May."), "BrickFest 2026");
  assert.equal(inferRole("Application received", "Applied for the Software Engineer, Intern (Winter 2027) role."), "Software Engineer, Intern (Winter 2027)");
});

test("interview wording without a specific time is confidence-limited, not retyped", () => {
  const e = type({ subject: "Interview confirmation", bodyText: "Your interview is confirmed. We look forward to speaking with you about the Analyst role." }).event!;
  assert.equal(e.type, "interview_scheduled");
  assert.ok(e.fieldConfidence!.type <= 0.4);
});
