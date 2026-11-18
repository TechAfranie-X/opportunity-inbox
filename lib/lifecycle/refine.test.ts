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
  assert.equal(o.outcome, "accepted", "the employer's screening paperwork followed the offer");
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

test("after an offer, onboarding mail is not an interview and not a goodbye", () => {
  const events = [
    ev({ type: "offer", day: 10, subject: "Congratulations on your job offer!" }),
    { ...ev({ type: "interview_invite", day: 40, subject: "Welcome to Acme - Pre-employment Screening Satisfied" }), reviewReasons: ["conflict: the wording reads like a goodbye, but it was read as \"interview invite\""] },
  ];
  const { events: refined } = refineEvents(events);
  assert.equal(refined[1].type, "status_update");
  assert.deepEqual(refined[1].reviewReasons, []);
  const [o] = buildOpportunities(refined);
  assert.equal(o.stage, "offer");
});

test("the same wording with no offer on record is left to the reader and the review queue", () => {
  const e = { ...ev({ type: "interview_invite", day: 40, subject: "Welcome to Acme - Pre-employment Screening Satisfied" }), reviewReasons: ["conflict: x"] };
  assert.equal(refineEvents([e]).events[0].type, "interview_invite");
});

test("an offer followed by employer onboarding is accepted: no pending decision action, stage stays Offer", async () => {
  const { buildActions } = await import("../recruiting/actions.ts");
  const events = [
    ev({ type: "offer", day: 10, subject: "Congratulations on your job offer!", role: "Platform Internship Program" }),
    ev({ type: "status_update", day: 20, subject: "Your background screening info", conf: 0.3, signals: ["near-miss"] }),
  ];
  const [o] = buildOpportunities(refineEvents(events).events);
  assert.equal(o.outcome, "accepted");
  assert.equal(o.stage, "offer");
  assert.equal(o.status, "active");
  const now = new Date(base + 22 * 86_400_000);
  assert.equal(buildActions([o], now, new Set()).filter((a) => a.kind === "offer_decision").length, 0);
  const open = buildOpportunities([ev({ type: "offer", day: 10, subject: "Congratulations on your job offer!", role: "Platform Internship Program" })])[0];
  assert.equal(open.outcome, "offer");
  assert.equal(buildActions([open], new Date(base + 12 * 86_400_000), new Set()).filter((a) => a.kind === "offer_decision").length, 1, "a bare offer still needs a decision");
});

test("pipeline counts include job applications only; scholarships stay available but apart", async () => {
  const { pulse } = await import("../recruiting/history.ts");
  const { isJob } = await import("../recruiting/format.ts");
  const opps = buildOpportunities([
    ev({ type: "applied", day: 1, subject: "Thank you for applying", company: "Acme", role: "Software Engineer Intern" }),
    ev({ type: "applied", day: 2, subject: "General Application Submitted: Merit Scholarship", company: "Fundco" }),
  ]);
  assert.equal(opps.length, 2);
  assert.equal(opps.filter(isJob).length, 1);
  assert.equal(pulse(opps).find((r) => r.stage === "applied")!.count, 1);
});

test("review regressions: offer-like wording that is not an offer", () => {
  for (const subject of ["Offer letter template for your review", "Re: Question about the offer letter timeline", "Have a question about your job offer? Join our webinar", "Job offer scam warning: how to spot fake offers", "Congratulations on your job offer search! Resume tips", "Congratulations, you've advanced! Next: job offer stage details", "We are pleased to extend an invitation to interview", "Pleased to offer you a spot in our info session"]) {
    assert.equal(refineEvents([ev({ type: "recruiter_outreach", day: 1, subject })]).events[0].type, "recruiter_outreach", subject);
  }
  for (const subject of ["Congratulations on your job offer!", "Congratulations on your internship offer from Acme", "We are pleased to extend you an offer of employment"]) {
    assert.equal(refineEvents([ev({ type: "status_update", day: 1, subject })]).events[0].type, "offer", subject);
  }
});

test("review regressions: genuine recruiting mail with look-alike words is kept", () => {
  for (const subject of ["Capstone Bank: Interview invitation for Summer Analyst", "Invitation: Interview Prep call with Acme recruiting", "Your interview practice session is confirmed", "Interview invitation – meet the Acme engineering team", "Acme Digest: Your interview on Monday", "Verification code for your Acme application", "Complete your interview before recruiting opens on Jan 5"]) {
    assert.equal(reasonOf(subject, { domain: "acme.example" }), null, subject);
  }
  assert.equal(reasonOf("Your application has been received", { domain: "chase.com" }), null);
  assert.equal(reasonOf("Interview scheduled: Acme Capstone Project team"), null);
});

test("review regressions: distinct employers do not merge on a generic suffix", () => {
  const events = [
    ev({ type: "applied", day: 0, subject: "Thank you for applying", company: "Apple", role: "Software Engineer Intern" }),
    ev({ type: "applied", day: 1, subject: "Thank you for applying", company: "Apple Bank", role: "Analyst" }),
    ev({ type: "applied", day: 2, subject: "Thank you for applying", company: "Stripe Technologies", role: "Engineer" }),
    ev({ type: "applied", day: 3, subject: "Thank you for applying", company: "Stripe", role: "Engineer" }),
  ];
  assert.deepEqual(refineEvents(events).events.map((e) => e.company), ["Apple", "Apple Bank", "Stripe Technologies", "Stripe"]);
  assert.equal(cleanCompany("Bank of the"), "Bank of the");
});

test("a program's own marketing is not interview or follow-up mail, but its application receipts and rejections stay", () => {
  const d = "learnco.example";
  const events = [
    ev({ type: "applied", day: 1, subject: "Application Received: Launchpad", domain: d, company: "LearnCo" }),
    ev({ type: "assessment_completed", day: 5, subject: "Weekly assessment submission reminder", domain: d, company: "LearnCo" }),
    ev({ type: "interview_scheduled", day: 9, subject: "Your peers are building with AI this fall", domain: d, company: "LearnCo" }),
    ev({ type: "follow_up", day: 10, subject: "Seats are filling. Don't wait.", domain: d, company: "LearnCo" }),
    ev({ type: "interview_scheduled", day: 11, subject: "Interview details for your Launchpad interview", domain: d, company: "LearnCo" }),
    ev({ type: "rejection", day: 12, subject: "Update on your Launchpad application", domain: d, company: "LearnCo" }),
  ];
  const { events: kept, excluded } = refineEvents(events);
  assert.deepEqual(excluded.map((x) => x.reason).sort(), ["course", "marketing", "marketing"]);
  assert.equal(kept.length, 3);
});

test("a domain with no course or practice mail is never treated as a program", () => {
  const events = [ev({ type: "interview_scheduled", day: 3, subject: "Your peers are building with AI", domain: "employer.example", company: "Employer" })];
  assert.equal(refineEvents(events).excluded.length, 0);
});

test("sweep-found mail with only continuity evidence and no candidacy in the subject becomes a possible item, not a pipeline stage", () => {
  const sweep = (subject: string, signals: string[], type: EventType = "status_update", domain = "shop.example") => ev({ type, day: 20, subject, domain, company: "Shop", signals: [...signals, "via:sweep"] });
  const events = [
    sweep("Flights to LGA are up $20", ["known-contact-continuity"]),
    sweep("Flight purchase confirmation", ["interview confirmed", "body"], "interview_scheduled"),
    sweep("Update to select benefits", ["rejection", "body"], "rejection"),
    sweep("Your interview with Shop is confirmed", ["interview confirmed", "body"], "interview_scheduled"),
    ev({ type: "status_update", day: 21, subject: "Flights are up $5", domain: "shop.example", company: "Shop", signals: ["known-contact-continuity"] }),
  ];
  const { events: kept } = refineEvents(events);
  const weak = kept.filter((e) => e.signals.includes("sweep-weak (refined)"));
  assert.deepEqual(weak.map((e) => e.subject).sort(), ["Flight purchase confirmation", "Flights to LGA are up $20", "Update to select benefits"]);
  assert.ok(weak.every((e) => e.signals.includes("near-miss") && e.type === "status_update"));
  assert.equal(kept.find((e) => e.subject === "Your interview with Shop is confirmed")?.type, "interview_scheduled");
  assert.ok(!kept.find((e) => e.subject === "Flights are up $5")?.signals.includes("sweep-weak (refined)"), "keyword-found mail is untouched");
});

test("a work-mode tag is not part of the role, so two receipts for one role are one opportunity", () => {
  assert.equal(cleanRole("Software Engineer Intern 2026 — Remote (US)"), "Software Engineer Intern 2026");
  assert.equal(cleanRole("Remote Sensing Analyst"), "Remote Sensing Analyst");
  assert.equal(cleanRole("Data Intern - Hybrid"), "Data Intern");
});

test("applications for a service, tenancy, membership or status are not candidacies; the same words in a job title keep the message", () => {
  for (const s of ["Your visa application has been received", "Your rental application - documents missing", "Student loan application status", "Application to join the chess club", "Thanks for applying as a volunteer", "Your visa interview is scheduled", "Your credit card application is under review"]) assert.equal(reasonOf(s), "non-employment", s);
  for (const s of ["Application received: Loan Officer position", "Thank you for applying: Membership Coordinator role", "Your application for the Visa Operations Intern", "Application received - Housing Analyst internship", "Interview invitation: Insurance Underwriter role", "Your application to Acme"]) assert.notEqual(reasonOf(s), "non-employment", s);
  assert.equal(reasonOf("Your visa application", { domain: "mail.myworkday.com" }), null, "an employer's applicant-tracking system is never excluded on wording");
});
