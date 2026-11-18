import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunities } from "../recruiting/opportunity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { cleanCompany, cleanRole, exclusionReason, refineEvents } from "./refine.ts";

// Synthetic fixtures: fictional employers and invented subjects that mirror the SHAPE of failures found in audits, not any real mailbox.
let n = 0;
const base = Date.UTC(2026, 0, 1);
const ev = (o: { type: EventType; day: number; subject: string; company?: string | null; role?: string | null; domain?: string; sender?: string; thread?: string; signals?: string[]; conf?: number; corrected?: boolean }): EffectiveEvent => {
  const id = `r${++n}`;
  return {
    id, gmailMessageId: id, gmailThreadId: o.thread ?? `t-${id}`, occurredAt: new Date(base + o.day * 86_400_000), outbound: false, senderName: o.sender ?? "Recruiting", senderDomain: o.domain ?? "myhr.example", subject: o.subject,
    type: o.type, company: o.company === undefined ? "Acme" : o.company, role: o.role ?? null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: o.conf ?? 0.9,
    fieldConfidence: { type: o.conf ?? 0.9, company: 0.9, role: 0.6 }, reviewReasons: [], signals: o.signals ?? [], corrected: o.corrected ?? false,
  };
};
const reasonOf = (subject: string, o: { domain?: string; sender?: string; company?: string | null } = {}) => exclusionReason({ subject, senderName: o.sender ?? "Someone", senderDomain: o.domain ?? "x.example", company: o.company ?? null });

test("context gate: newsletters, digests, mock practice, courses and consumer accounts are not candidacies", () => {
  assert.equal(reasonOf("Acme News: Join Foo, Bar + alums this week"), "newsletter");
  assert.equal(reasonOf("Starts Monday: Meet the Globex team before internship recruiting opens"), "newsletter");
  assert.equal(reasonOf("[Reminder] Your Mock Interview session starts soon"), "practice");
  assert.equal(reasonOf("Invitation: 1:1 Behavioral Interview Week"), "practice");
  assert.equal(reasonOf("Weekly assessment submission reminder"), "course");
  assert.equal(reasonOf("Your email verification code", { domain: "broker.example" }), "consumer-account");
  assert.equal(reasonOf("Reminder: Your application is pending", { domain: "broker.example" }), null, "an unknown domain is not enough to call a pending application an account");
  assert.equal(reasonOf("Reminder: Your application is pending", { domain: "robinhood.com" }), "consumer-account");
  assert.equal(reasonOf("Your application expires in 60 days", { domain: "robinhood.com" }), "consumer-account");
});

test("context gate: real recruiting mail is kept, and an applicant-tracking system is never excluded on wording", () => {
  assert.equal(reasonOf("Thank you for applying!"), null);
  assert.equal(reasonOf("Your application to Software Engineer Intern at Acme"), null);
  assert.equal(reasonOf("Interview prep resources", { domain: "myworkday.com" }), null);
  assert.equal(reasonOf("Congratulations on your job offer!"), null);
  assert.equal(reasonOf("Thank you for applying to Coinbase", { domain: "coinbase.com" }), null, "finance employers recruit too");
  assert.equal(reasonOf("Important information about your application to Robinhood", { domain: "robinhood.com" }), null);
  assert.equal(reasonOf("Your Acme application: interview with the team", { domain: "greenhouse.io" }), null);
  assert.equal(reasonOf("Software Engineer Intern: next steps", { domain: "robinhood.com" }), null); // an employer's own recruiting mail from a finance employer is still recruiting
});

test("a newsletter-derived 'offer' never becomes an offer, a person's own correction is never overridden", () => {
  const news = ev({ type: "offer", day: 1, subject: "Acme News: Meet the Globex team before internship recruiting opens", company: null, domain: "learn.example", sender: "Acme News" });
  assert.equal(buildOpportunities([news]).length, 0);
  const kept = ev({ type: "interview_scheduled", day: 2, subject: "Mock Interview session", company: "Acme", corrected: true });
  assert.equal(buildOpportunities([kept]).length, 1, "the person said it is real");
});

test("explicit offer wording is an offer, even when the reader set it aside as a near miss", () => {
  const events = [
    ev({ type: "applied", day: 0, subject: "Thank you for applying!", role: "Platform Internship Program" }),
    ev({ type: "interview_invite", day: 5, subject: "You are invited to interview", role: "Platform Internship Program" }),
    ev({ type: "status_update", day: 30, subject: "Congratulations on your job offer!", role: "Platform Internship Program", conf: 0.3, signals: ["near-miss", "rejected:no_recruiting_language"] }),
    ev({ type: "status_update", day: 45, subject: "Your background screening info", conf: 0.3, signals: ["near-miss"] }),
  ];
  const { events: refined } = refineEvents(events);
  assert.equal(refined[2].type, "offer");
  assert.ok(!refined[2].signals.includes("near-miss"));
  assert.ok(!refined[3].signals.includes("near-miss"), "paperwork after an offer is part of the same candidacy");
  const [o] = buildOpportunities(refined);
  assert.equal(o.stage, "offer");
  assert.equal(o.outcome, "offer");
  assert.equal(o.events.length, 4);
});

test("paperwork wording alone, with no offer in the record, stays a near miss", () => {
  const e = ev({ type: "status_update", day: 3, subject: "Your background screening info", conf: 0.3, signals: ["near-miss"] });
  assert.ok(refineEvents([e]).events[0].signals.includes("near-miss"));
});

test("promotional 'offer' wording is not an offer", () => {
  const e = ev({ type: "status_update", day: 1, subject: "Limited-time offer: 20% off your plan" });
  assert.equal(refineEvents([e]).events[0].type, "status_update");
});

test("entities: sentence fragments are not employers or roles", () => {
  assert.equal(cleanCompany("Acme Corp and the"), "Acme Corp");
  assert.equal(cleanCompany("Ramp 2025"), "Ramp");
  assert.equal(cleanRole("and the 2026 Platform Internship Program"), "2026 Platform Internship Program");
  assert.equal(cleanRole("Software Engineer, Intern (Summer"), "Software Engineer, Intern");
  assert.equal(cleanRole("Software Engineer, Intern (Summer or Winter)"), "Software Engineer, Intern (Summer or Winter)");
  assert.equal(cleanRole("Engineering team"), null);
  assert.equal(cleanRole("Backend Engineer"), "Backend Engineer");
});

test("an employer's legal/industry-suffix variant joins the established employer; unrelated names do not", () => {
  const events = [
    ev({ type: "applied", day: 0, subject: "Thank you for applying!", company: "Acme", role: "2026 Platform Internship Program" }),
    ev({ type: "interview_invite", day: 3, subject: "You are invited to interview", company: "Acme Insurance Company and the", role: "2026 Platform Internship Program" }),
    ev({ type: "applied", day: 4, subject: "Thank you for applying", company: "Acmeron Labs", role: "Designer" }),
  ];
  const opps = buildOpportunities(events);
  assert.equal(opps.length, 2);
  assert.deepEqual(opps.map((o) => o.company).sort(), ["Acme", "Acmeron Labs"]);
  assert.equal(opps.find((o) => o.company === "Acme")!.events.length, 2);
});

test("one assessment under two names is one opportunity and the completion supersedes the reminder", () => {
  const events = [
    ev({ type: "assessment", day: 0, subject: "Globex invited you to take the Globex 2025 Coding Assessment", company: "Globex", role: "Software Engineer", domain: "codesignal.example" }),
    ev({ type: "assessment", day: 1, subject: "Reminder: Globex is waiting for your assessment", company: "Globex", role: "Software Engineer", domain: "codesignal.example" }),
    ev({ type: "assessment_completed", day: 3, subject: "Assessment completed: Globex 2025 Coding Assessment", company: "Globex 2025", role: null, domain: "codesignal.example" }),
  ];
  const opps = buildOpportunities(events);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].events.length, 3);
});

test("an unfinished-application nudge is not recruiter interest", () => {
  const e = ev({ type: "recruiter_outreach", day: 1, subject: "Acme - Incomplete Application" });
  assert.equal(refineEvents([e]).events[0].type, "follow_up");
  const real = ev({ type: "recruiter_outreach", day: 1, subject: "Quick chat about a role at Acme?" });
  assert.equal(refineEvents([real]).events[0].type, "recruiter_outreach");
});

test("course sessions after a rejection do not create a second, active opportunity for the same program", () => {
  const prog = "Launchpad Pre-Internship";
  const events = [
    ev({ type: "applied", day: 0, subject: "Application Received", company: "Learnco", role: prog, domain: "learn.example" }),
    ev({ type: "rejection", day: 40, subject: "Update on your application", company: "Learnco", role: prog, domain: "learn.example" }),
    ev({ type: "assessment_completed", day: 50, subject: "Thanks for taking the TIP102: Unit 2 Assessment", company: "Learnco", role: prog, domain: "learn.example" }),
    ev({ type: "interview_scheduled", day: 51, subject: "Technical Interview Prep session", company: "Learnco", role: prog, domain: "learn.example" }),
  ];
  const opps = buildOpportunities(events);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].status, "closed");
});

test("scholarships and mentorship programs are typed, jobs and internships stay jobs", async () => {
  const { opportunityKind } = await import("./refine.ts");
  assert.equal(opportunityKind([{ subject: "General Application Submitted: Merit Scholarship", role: null }]), "scholarship");
  assert.equal(opportunityKind([{ subject: "Mentor Application Received - Peer Mentorship Program", role: "Mentorship Program" }]), "mentorship");
  assert.equal(opportunityKind([{ subject: "Thank you for applying", role: "Software Engineer Intern" }]), "job");
  assert.equal(opportunityKind([{ subject: "Application received", role: null }]), "job");
  const opps = buildOpportunities([ev({ type: "applied", day: 1, subject: "General Application Submitted: Merit Scholarship", company: "Fundco" })]);
  assert.equal(opps[0].kind, "scholarship");
});
