import assert from "node:assert/strict";
import test from "node:test";
import { companyFromText, inferCompany } from "./company.ts";

const co = (from: string, subject: string, body = "") => inferCompany({ from, subject, body });

test("display name that is an email address is never used as the company", () => {
  assert.equal(co("no-reply@acme.com", "Thank you for applying to Acme"), "Acme");
  assert.equal(co("noreply@mail.acme.jobs", "Keep track of your application"), "Acme");
  assert.equal(co("no-reply@us.greenhouse-mail.io", "Thank You for Applying to Initech!"), "Initech");
});

test("Workday-style sender names reduce to the company", () => {
  assert.equal(co("do-not-reply acme <acme@myworkday.com>", "Thank you for applying"), "Acme");
  assert.equal(co("workday-no-reply globex <x@myworkday.com>", "Thank you for applying!"), "Globex");
  assert.equal(co("Initech Workday System <x@myworkday.com>", "Application Status"), "Initech");
});

test("Workday tenant in the address is the last resort", () => {
  assert.equal(co("hooli@myworkday.com", "[Action Required] Please create your candidate home"), "Hooli");
});

test("generic subject-lead words are not companies", () => {
  for (const subject of ["Action Needed: Next steps for your application", "Reminder: please complete", "Application Received: Jane Doe", "Urgent: your assessment"]) {
    assert.equal(companyFromText(subject), null, subject);
  }
});

test("a trailing generic noun is stripped from the captured name", () => {
  assert.equal(co("careers@acme.com", "Acme Application: 2026-1234 - Software Engineer Intern"), "Acme");
});

test("assessment platforms: the company comes from the subject, not the platform", () => {
  assert.equal(co("CodeSignal <noreply@codesignal.com>", "Globex invited you to take Globex Coding Assessment"), "Globex");
  assert.equal(co("CodeSignal <noreply@codesignal.com>", "Request from Globex has expired."), "Globex");
  assert.equal(co("CodeSignal <noreply@codesignal.com>", "Reminder: Globex is waiting for your Coding Assessment result"), "Globex");
  assert.equal(co("CoderPad <x@coderpad.io>", "Next step: Initech online coding assessment (due in 7 days)"), "Initech");
});

test("ATS platform mail: company comes from the subject even with capitalised keywords", () => {
  assert.equal(co("Oracle <workflow.mail.us2.cloud.oracle.com>", "Thank You for Applying to Globex"), "Globex");
  assert.equal(co("x@tal.net", "Initech | Application update"), "Initech");
});

test("content spelling beats an ugly domain-derived name", () => {
  assert.equal(co("jobs@makeacme.com", "Thank you for your application to Acme, Sam!"), "Acme");
});

test("brand recovery needs most of the domain label, not a stub", () => {
  // "Last" must not become the company for lastmile-ed.org.
  assert.notEqual(co("hello@lastmile-ed.org", "We received your application", "Last year we ..."), "Last");
});

test("trailing connectors are trimmed", () => {
  assert.equal(companyFromText("Thank you for applying to NIKE and"), "NIKE");
});

test("hyphenated domain labels recover the full spelled name", () => {
  assert.equal(inferCompany({ from: "recruiting@hudson-trading.com", subject: "Thank you for applying", body: "Welcome to Hudson River Trading." }), "Hudson River Trading");
});

test("scheduling/ATS platforms are not the company; subject names it", () => {
  assert.equal(inferCompany({ from: "Yello <x@yello.co>", subject: "Invitation to Interview with Acme", body: "" }), "Acme");
  assert.equal(inferCompany({ from: "ModernLoop <x@interviews.modernloop.io>", subject: "Your interview availability with Acme was submitted", body: "" }), null === null ? "Acme" : "");
});

test("'Company Event Application Update' and 'Assessment completed: Company Pre-Screen'", () => {
  assert.equal(inferCompany({ from: "x@acme.tal.net", subject: "Acme Event Application Update", body: "" }), "Acme");
  assert.equal(inferCompany({ from: "CodeSignal <x@codesignal.com>", subject: "Assessment completed: Acme Pre-Screen", body: "" }), "Acme");
});
