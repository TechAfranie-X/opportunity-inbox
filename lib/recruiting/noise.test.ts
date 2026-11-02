import assert from "node:assert/strict";
import test from "node:test";
import { inferCompany } from "./company.ts";
import { extractEvent } from "./extract.ts";
import type { RecruitingEmail } from "./types.ts";

const at = new Date(Date.UTC(2026, 10, 1, 10));
const mail = (subject: string, bodyText: string, from = "Acme Careers <careers@acme.com>"): RecruitingEmail => ({
  id: "m", threadId: "t", from, subject, receivedAt: at, outbound: false, bodyText,
});

test("verification / security code emails are not events", () => {
  for (const s of ["Security code for your application to Acme", "Your verification code", "Your one-time code for Acme"]) {
    assert.equal(extractEvent(mail(s, "Use this code to continue your application.")), null, s);
  }
});

test("promotions borrowing recruiting words are not events", () => {
  for (const s of [
    "Summer 2027 Software Engineering Internship Applications Are Now Open!",
    "Apply Today! Acme internship applications",
    "Don't miss out: your 2027 consultant application is still open",
    "Your free offer is expiring",
  ]) {
    assert.equal(extractEvent(mail(s, "Join our team. Apply for the internship role. We are hiring.")), null, s);
  }
});

test("promotional subjects cannot hide a real rejection or confirmed interview", () => {
  const rej = extractEvent(mail("Application status: applications now open for next cycle", "Unfortunately, we will not be moving forward with your candidacy."));
  assert.equal(rej?.type, "rejection");
});

test("an offer needs offer-letter language, not 'your free offer'", () => {
  assert.equal(extractEvent(mail("Your offer is ready", "Please review your offer letter for the Software Engineer Intern role."))?.type, "offer");
});

test("single generic words are never a company", () => {
  assert.equal(inferCompany({ from: "no-reply@us.greenhouse-mail.io", subject: "Update on Your Job Application", body: "" }), null);
});

test("brand spelling is recovered from the text for domain-only names", () => {
  assert.equal(inferCompany({ from: "jobs@owenscorning.com", subject: "Application update", body: "Thank you for your interest in Owens Corning." }), "Owens Corning");
  assert.equal(inferCompany({ from: "careers@mongodb.com", subject: "An update about your application", body: "Hello from MongoDB recruiting." }), "MongoDB");
});

test("platforms that host many companies are not the company", () => {
  assert.equal(inferCompany({ from: "noreply@interfolio.com", subject: "Reminder: your application to Johns Hopkins University is due", body: "" }), "Johns Hopkins University");
});

test("testimonials, info sessions, workshops and 'boost your' vendor promos are not events", () => {
  for (const s of [
    "I landed my first tech internship thanks to Acme",
    "Next Steps After The Acme Info Session",
    "I'd like to invite you to our Interview + Portfolio Workshop (no cost)",
    "Boost your interview odds: add a verified skill",
  ]) {
    assert.equal(extractEvent(mail(s, "Join our team. Apply for the internship role. We are hiring. Interview tips.")), null, s);
  }
});
