import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { employerProvenance, nameOfSenderDomain, senderBrand } from "./grounding.ts";

// Fictional senders. The failure pattern: the name of whoever SENT a message is taken for the employer. Positive cases and look-alikes both.
const mail = (from: string, subject: string, body: string): RecruitingEmail => ({ id: "m", threadId: "t", from, subject, bodyText: body, receivedAt: new Date("2026-01-01"), outbound: false });
const event = (company: string | null, signals: string[] = []): ExtractedEvent => ({ gmailMessageId: "m", gmailThreadId: "t", occurredAt: new Date("2026-01-01"), outbound: false, senderName: "", senderDomain: "", subject: "", type: "applied", company, role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.7, fieldConfidence: { type: 0.7, company: 0.35, role: 0 }, reviewReasons: [], signals });

test("a sender label that is the employer plus a function word names the employer; a person, a function-only label or a platform label does not", () => {
  assert.equal(senderBrand(mail("Copperline Careers <careers@copperline-logistics.example>", "Hello", "Thanks for applying.")), "Copperline");
  assert.equal(senderBrand(mail("Kleinwerk Karriere <no-reply@talentbogen.example>", "Bewerbung", "Bewerbung bei Kleinwerk Maschinenbau eingegangen.")), "Kleinwerk");
  assert.equal(senderBrand(mail("Marcus Li <marcus.li@mailbox.example>", "Quick chat?", "Hi, Marcus here from Harbor & Pine.")), null, "a person's name is never a brand");
  assert.equal(senderBrand(mail("Candidate Portal <noreply@pathlight-ats.example>", "Update", "x")), null, "only function words left");
  assert.equal(senderBrand(mail("Interview Team <interviews@quill-labs.example>", "What to expect", "Here is what to expect in your upcoming interview.")), null, "'interview' is a hiring word, not an employer");
  assert.equal(senderBrand(mail("Zorbex Careers <jobs@unrelated-host.example>", "Hi", "Hello there.")), null, "the label must be corroborated by the text or the sender's own domain");
});

test("a name that is just the sender's own domain is marked sender-only even when the text mentions the platform; a name the text itself writes is not", () => {
  const platform = mail("Applicant Hub <no-reply@greenhub-ats.example>", "Application submitted", "Your application to Solstice Robotics was submitted. Powered by Greenhub-ats.");
  assert.equal(nameOfSenderDomain(platform, "Greenhub-ats"), true);
  assert.ok(employerProvenance(platform, event("Greenhub-ats")).signals.includes("employer:sender-only"));
  assert.ok(!employerProvenance(platform, event("Solstice Robotics")).signals.includes("employer:sender-only"));
});

test("provenance is idempotent and never rewrites a name it has no evidence against", () => {
  const m = mail("Recruiting <jobs@orbis.example>", "Application received", "Thanks for applying to Orbis.");
  const once = employerProvenance(m, event("Orbis"));
  const twice = employerProvenance(m, once);
  assert.deepEqual(twice.signals, once.signals);
  assert.equal(twice.company, "Orbis");
});

test("a division is not lost to its parent: the brand is the longest run of label words that the sender's domain also spells", () => {
  assert.equal(senderBrand(mail("Nordmarkt Logistik Karriere <karriere@logistik.nordmarkt.example>", "Bewerbung", "Eingang Ihrer Bewerbung.")), "Nordmarkt Logistik");
  assert.equal(senderBrand(mail("Nordmarkt Digital Talent <jobs@digital.nordmarkt.example>", "Bewerbung", "Eingang Ihrer Bewerbung.")), "Nordmarkt Digital");
  assert.equal(senderBrand(mail("Intuit Talent Acquisition <noreply@intuit.com>", "Application", "Thanks for applying.")), "Intuit");
});
