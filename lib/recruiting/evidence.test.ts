import assert from "node:assert/strict";
import test from "node:test";
import { inferRole } from "./company.ts";
import { extractAll, extractWithReason } from "./extract.ts";
import { roleFromFrames } from "./role.ts";
import type { RecruitingEmail } from "./types.ts";

// Synthetic mail only; each test states the general property it protects.
const mail = (o: Partial<RecruitingEmail>): RecruitingEmail => ({ id: "m", threadId: "t", from: "Acme Recruiting <jobs@acme.com>", subject: "", bodyText: "", receivedAt: new Date("2026-03-01T12:00:00Z"), outbound: false, ...o });
const ev = (o: Partial<RecruitingEmail>) => extractWithReason(mail(o)).event;

test("evidence combines: a specific task in the body outranks a generic nudge or confirmation in the subject", () => {
  // reminder wrapper around an assessment: the reminder is a modifier, the assessment is the event
  const a = ev({ subject: "Action Required: Complete Your Application", bodyText: "Thank you for your interest in Acme. We noticed you have not yet completed your application for the Analyst Program. You must submit your pre-interview assessment within 5 days." })!;
  assert.equal(a.type, "assessment");
  assert.ok(a.fieldConfidence!.type < 0.6, "a message that argues with itself is not trusted at the subject tier's 0.9");
  // confirmation whose next step is a task for the reader
  assert.equal(ev({ subject: "Your application to Acme", bodyText: "We have received your application for the Design Intern role. As the next stage of our process, we invite you to create and submit a video profile." })!.type, "assessment");
});

test("an unfinished application is a follow-up whichever place says so", () => {
  assert.equal(ev({ subject: "Your application with Acme", bodyText: "Thank you for applying to Acme! We noticed you did not complete your application. Please use the link to complete it." })!.type, "follow_up");
});

test("confirmation wording that is not a nudge stays a confirmation", () => {
  assert.equal(ev({ subject: "Your application with Acme", bodyText: "We received your application for the Analyst role. You can complete your profile at any time." })!.type, "applied");
});

test("an interview is scheduled when one sentence carries the interview, a confirmation word and a time; plurals count", () => {
  assert.equal(ev({ from: "Calendly <no-reply@calendly.com>", subject: "Confirmed: Spring Interviews with Acme Fellowship", bodyText: "Your Spring Interviews with Acme Fellowship at 02:15pm on Monday, January 5, 2026 is scheduled." })!.type, "interview_scheduled");
  assert.equal(ev({ subject: "Re: Moving forward", bodyText: "We are thrilled to move forward with you! Here are details about your upcoming interviews and the team you will meet." })!.type, "interview_scheduled");
});

test("an expired request is a status line about the opportunity, not a task", () => {
  const e = ev({ from: "CodeSignal <no-reply@codesignal.com>", subject: "Request from Acme has expired.", bodyText: "The request from Acme to take Acme Pre-Screen has expired." })!;
  assert.equal(e.type, "status_update");
  assert.equal(e.eventDate, null);
});

test("an employer update with no request of the reader is a status update, not a nudge", () => {
  assert.equal(ev({ subject: "Update on Acme", bodyText: "Thank you again for meeting last week. We are nearing the final stages of hiring for our intern cohort and will share next steps when we can." })!.type, "status_update");
});

test("a reader-directed announcement of an application opening is generic; personal outreach is not", () => {
  assert.equal(ev({ subject: "Prepare to apply", bodyText: "Thank you for your interest in Acme. Applications for our 2027 Analyst Program will open on January 1. Create your account in advance." }), null);
  assert.equal(ev({ from: "Sam Lee <sam.lee@acme.com>", subject: "Internships at Acme", bodyText: "Since you have connected with us before, I wanted to reach out directly and invite you to apply for our Summer 2027 internships." })?.type, "recruiter_outreach");
});

test("receipts, application portals for prizes, and event selections are not hiring", () => {
  assert.equal(extractWithReason(mail({ from: "Rides <receipts@rides.example>", subject: "Your trip", bodyText: "Receipt. Total $52.95. Fare $37.33. Thank you for applying the voucher you applied for." })).reason, "transactional");
  assert.equal(ev({ from: "Awards <no-reply@mail.smapply.net>", subject: "Reminder: Your application due date is Mar 1", bodyText: "The deadline to submit your nominee for this year's Education Prize is Mar 1. Access your application below." }), null);
  assert.equal(ev({ from: "Fund <info@fund.example>", subject: "Application Update", bodyText: "Thank you for applying to the Annual Career Conference. We regret to inform you that you were not selected to participate in this year's conference." }), null);
});

test("roles come from the slot the sender writes them in, not from a vocabulary", () => {
  const cases: Array<[string, string]> = [
    ["Thank you for applying for the role of 2026 Innovate Externship - R-2025-44157 We are currently processing it.", "2026 Innovate Externship"],
    ["Although we have decided to move forward with other candidates for R26658 - Launch Intern - Summer 2026 , we appreciate your time.", "Launch Intern - Summer 2026"],
    ["We have decided not to move forward with your application for the 2026 Explore HRT program. If you would like", "2026 Explore HRT program"],
    ["Congratulations on your offer! Your Summer 2027 Intern - Software Engineer offer packet is ready.", "Summer 2027 Intern - Software Engineer"],
    ["Thank you for your interest in the 2026 Career Academy position. The next step is an assessment.", "2026 Career Academy"],
    ["We have received your application for the following: Internship - UX Design - 62217. As the next stage", "Internship - UX Design"],
  ];
  for (const [text, want] of cases) assert.equal(roleFromFrames(text, null), want, text);
});

test("a company or a link in a role slot is not a role", () => {
  assert.equal(roleFromFrames("Thank you for applying to Group One Trading! We noticed you did not finish.", "Group One Trading"), null);
  assert.equal(roleFromFrames("See your application for https://example.com/apply today.", null), null);
  assert.equal(inferRole("Hello", "Thank you for your interest in Acme and our early career programs."), null);
});

test("a message without a role takes the thread's role, or the employer's only role; two roles stay unguessed", () => {
  const withRole = mail({ id: "1", threadId: "t1", subject: "Interview invitation", from: "Ana Ruiz <ana.ruiz@acme.com>", bodyText: "We would like to interview you for the Data Analyst Intern role. Please select a time." });
  const without = mail({ id: "2", threadId: "t1", subject: "Interview confirmation", from: "Ana Ruiz <ana.ruiz@acme.com>", bodyText: "Your interview is confirmed for Tuesday, March 3 at 2:00 pm.", receivedAt: new Date("2026-03-02T12:00:00Z") });
  const roles = Object.fromEntries(extractAll([withRole, without]).map((e) => [e.gmailMessageId, e.role]));
  assert.equal(roles["2"], roles["1"]);
  assert.ok(roles["1"]);
  const other = mail({ id: "3", threadId: "t3", subject: "Interview invitation", from: "Ana Ruiz <ana.ruiz@acme.com>", bodyText: "We would like to interview you for the Backend Engineer Intern role. Please select a time.", receivedAt: new Date("2026-03-03T12:00:00Z") });
  const lone = mail({ id: "4", threadId: "t4", subject: "Interview confirmation", from: "Ana Ruiz <ana.ruiz@acme.com>", bodyText: "Your interview is confirmed for Friday, March 6 at 2:00 pm.", receivedAt: new Date("2026-03-04T12:00:00Z") });
  assert.equal(extractAll([withRole, other, lone]).find((e) => e.gmailMessageId === "4")!.role, null);
});
