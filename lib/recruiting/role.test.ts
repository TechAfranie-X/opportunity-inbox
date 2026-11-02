import assert from "node:assert/strict";
import test from "node:test";
import { cleanRole, inferRole } from "./company.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, EventType } from "./types.ts";

test("requisition ids and job-number parentheticals are removed", () => {
  assert.equal(cleanRole("R158531 2026 Intern", "Acme"), "2026 Intern");
  assert.equal(cleanRole("JR2023495 Acme 2027 Internship", "Acme"), "2027 Internship");
  assert.equal(cleanRole("AI Software Engineering Intern (Job number: 200049019)", null), "AI Software Engineering Intern");
  assert.equal(cleanRole("2134100 Summer 2027 Undergraduate Internship", null), "Summer 2027 Undergraduate Internship");
});

test("leading articles, legal suffixes and company names are stripped", () => {
  assert.equal(cleanRole("Inc. Software Engineering Undergraduate Internship", "Acme"), "Software Engineering Undergraduate Internship");
  assert.equal(cleanRole("Your Fellowship Intern", null), "Fellowship Intern");
  assert.equal(cleanRole("Acme's Data Analyst Intern", "Acme"), "Data Analyst Intern");
  assert.equal(cleanRole("Acme Backend Engineer", "Acme"), "Backend Engineer");
});

test("nothing meaningful left means no role", () => {
  assert.equal(cleanRole("R1234567", null), null);
});

test("'Full-Time' is not split into a role word", () => {
  assert.equal(inferRole("Acme Full-Time Entry-Level Consultant application", "", "Acme"), "Full-Time Entry-Level Consultant");
});

test("loose role patterns are ignored in the body (recruiter signatures)", () => {
  assert.equal(inferRole("An update on your application", "Best,\nWill Shelton Student Engagement Consultant\nAcme"), null);
  assert.equal(inferRole("An update", "Thank you for applying for the Data Analyst Intern position."), "Data Analyst Intern");
});

let n = 0;
const ev = (type: EventType, role: string | null, day: number): EffectiveEvent => {
  n += 1;
  return {
    id: `e${n}`, gmailMessageId: `m${n}`, gmailThreadId: `t${n}`, occurredAt: new Date(Date.UTC(2026, 0, 1) + day * 86_400_000),
    outbound: false, senderName: "x", senderDomain: "x.com", subject: "s", type, company: "Acme", role,
    eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, signals: [], corrected: false,
  };
};

test("re-applying to the same role after a rejection is a new opportunity; same-day generic mail joins the new one", () => {
  const opps = buildOpportunities([
    ev("applied", "Software Engineer Intern", 0),
    ev("rejection", "Software Engineer Intern", 20),
    ev("applied", "Software Engineer Intern", 60),
    ev("applied", null, 60),
  ]);
  assert.equal(opps.length, 2);
  assert.equal(opps.find((o) => o.status === "active")!.events.length, 2);
});
