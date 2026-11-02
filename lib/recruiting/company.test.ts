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

test("brands that start lowercase (eBay) and assessment-vendor reminders resolve to the company", () => {
  const codesignal = "CodeSignal <noreply@codesignal.com>";
  assert.equal(co(codesignal, "Jane Doe, don't forget to complete your eBay Pre-Screen!"), "eBay");
  assert.equal(co(codesignal, "Reminder: Globex Test Invitation"), "Globex");
  assert.equal(co(codesignal, "Your result for Initech Coding Assessment is now available"), "Initech");
});

test("a bare 'complete your <adjective> assessment' does not make the adjective a company", () => {
  assert.equal(co("noreply@codesignal.com", "Take the Cognitive Assessment"), null);
});

test("a recruiter's name on platform mail is not a company; two-word organisations still are", () => {
  assert.equal(co("Julia Ngo <x@talent.icims.com>", "Coding Assessment Follow Up"), null);
  assert.equal(co("Advanced Space <x@us.greenhouse-mail.io>", "Thank you for your interest"), "Advanced Space");
  assert.equal(co("Synchrony Relations <x@yello.co>", "Thank you for your application"), "Synchrony Relations");
});

test("recruiting words in a domain label are stripped (drwrecruiting, talent-citadel)", () => {
  assert.equal(co("jobs@drwrecruiting.com", "Application update", "Thank you for your interest in DRW."), "DRW");
  assert.equal(co("jobs@talent-citadel.com", "Your application", "Citadel Associate Program"), "Citadel");
});

test("initials domains resolve to the spelled-out name used in the subject (gs -> Goldman Sachs)", () => {
  assert.equal(co("recruiting@careers.gs.com", "Goldman Sachs: Complete Your Technical Assessment"), "Goldman Sachs");
});
