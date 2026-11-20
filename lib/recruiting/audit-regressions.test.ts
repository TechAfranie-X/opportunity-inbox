import assert from "node:assert/strict";
import test from "node:test";
import { buildActions } from "./actions.ts";
import { pipelineBuckets, nextMoment } from "./history.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, RecruitingEmail } from "./types.ts";
import { readMail } from "../reliability/assess.ts";
import { isNearMiss } from "../reliability/flags.ts";

/**
 * Regression cases for an independent audit of the real application. Each case is a FICTIONAL analogue that keeps the shape of the observed failure (never the real employer,
 * subject or text) with its positive and negative counterexamples. See docs/audit-remediation.md for the audit-to-fix matrix.
 */
let n = 0;
const mail = (from: string, subject: string, body: string, at: string, o: { thread?: string; outbound?: boolean } = {}): RecruitingEmail => ({ id: `a${++n}`, threadId: o.thread ?? `t${n}`, from, subject, bodyText: body, receivedAt: new Date(at), outbound: o.outbound ?? false });
const opps = (emails: RecruitingEmail[]) => {
  const events: EffectiveEvent[] = readMail(emails).filter((e) => !isNearMiss(e)).map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
  return buildOpportunities(events);
};
const ATS = "Orbis Recruiting <no-reply@myhr-orbis.example>";

test("audit: an explicit closure under a bland ATS subject ends that application; a later process for a different cycle stays separate and open", () => {
  const o = opps([
    mail("Orbis Careers <careers@orbis.example>", "Application Received for 2026 R&D Innovate Externship", "Hi Sam, we received your application for the 2026 R&D Innovate Externship.", "2026-01-05T10:00:00Z", { thread: "ext1" }),
    mail("Orbis Careers <careers@orbis.example>", "Invitation to Interview with Orbis", "Hi Sam, please pick a time for your externship interview.", "2026-03-16T10:00:00Z", { thread: "ext2" }),
    mail(ATS, "Update on Your Job Application", "Hi Sam, thank you for your interest in the 2026 R&D Innovate Externship. After careful review, your application is no longer under consideration for this requisition.", "2026-06-05T10:00:00Z", { thread: "ext3" }),
    mail("University Relations <relations@orbis.example>", "2027 Intern Interview Schedule", "Hi Sam, your interview for the 2027 Intern program is confirmed for Tuesday, August 11 at 10:00 AM.", "2026-08-10T10:00:00Z", { thread: "int1" }),
  ]);
  const externship = o.find((x) => /externship/i.test(x.role ?? ""));
  assert.ok(externship, "externship opportunity exists");
  assert.equal(externship.status, "closed");
  assert.equal(externship.outcome, "rejected");
  const other = o.find((x) => /2027/.test(x.role ?? "") || x.events.some((e) => /2027/.test(e.subject)));
  assert.ok(other && other !== externship && other.status === "active", "the 2027 process is separate and open");
});

test("audit: closure wording is not invented from look-alikes (a newsletter, an invitation that mentions other candidates)", () => {
  const o = opps([
    mail(ATS, "Update on Your Job Application", "Hi Sam, your application is under review. We will contact you about next steps. Other candidates are also being considered.", "2026-02-01T10:00:00Z"),
  ]);
  assert.ok(o.every((x) => x.status === "active"));
});

test("audit: a legitimately reversed rejection reopens the process and is flagged, not silently closed", () => {
  const o = opps([
    mail("Orbis Careers <careers@orbis.example>", "Your Orbis application", "Hi Sam, thanks for applying to the Data Intern role.", "2026-01-05T10:00:00Z", { thread: "r1" }),
    mail(ATS, "Update on Your Job Application", "Hi Sam, your application is no longer under consideration for the Data Intern role.", "2026-02-10T10:00:00Z", { thread: "r1" }),
    mail(ATS, "Please disregard", "Hi Sam, please disregard our previous message; it was sent in error. Your application for the Data Intern role is still active.", "2026-02-12T10:00:00Z", { thread: "r1" }),
  ]);
  assert.equal(o.length, 1);
  assert.equal(o[0].status, "active");
  assert.ok(o[0].contradictions?.some((c) => c.kind === "reopened"));
});

test("audit: an accepted offer is accepted (the student's own words), settled, and counted apart from active", () => {
  const emails = [
    mail("Orbis Careers <careers@orbis.example>", "Thanks for applying", "Hi Sam, we received your application for the Software Intern role.", "2026-05-08T10:00:00Z", { thread: "s1" }),
    mail("Dana Reyes <dana.reyes@orbis.example>", "Your Orbis offer", "Hi Sam, we are pleased to extend you an offer for the Software Intern role. Please respond by July 22.", "2026-07-06T10:00:00Z", { thread: "s1" }),
    mail("Sam <sam@campus.example>", "Re: Your Orbis offer", "Hi Dana, I will be joining the team this summer, and I have completed the pre-start paperwork.", "2026-07-10T10:00:00Z", { thread: "s1", outbound: true }),
  ];
  const o = opps(emails);
  assert.equal(o.length, 1);
  assert.equal(o[0].outcome, "accepted");
  const b = pipelineBuckets(o, new Date("2026-11-20T12:00:00Z"));
  assert.equal(b.accepted.length, 1);
  assert.equal(b.active.length, 0);
  assert.equal(buildActions(o, new Date("2026-11-20T12:00:00Z")).filter((a) => a.kind === "offer_decision").length, 0, "no pending offer decision");
});

test("audit: a workshop selection is an event, not a job offer, and never an offer decision after its acceptance deadline", () => {
  // the model (not the rules) recognises such mail; the event it creates is typed `offer` with the workshop's title as its name. Built by hand here: the point is what the product DOES with it.
  const e = { gmailMessageId: "w1", gmailThreadId: "tw", occurredAt: new Date("2026-10-24T10:00:00Z"), outbound: false, senderName: "Program Office", senderDomain: "cyberws.example", subject: "Congratulations, you were selected for the Cloud Cybersecurity Workshop", type: "offer", company: "Cloud Cybersecurity Workshop", role: null, eventDate: new Date("2026-10-28T00:00:00Z"), eventDateHasTime: false, dateKind: "deadline", confidence: 0.72, fieldConfidence: { type: 0.72, company: 0.5, role: 0 }, reviewReasons: [], signals: ["semantic:event"], id: "w1", corrected: false } as EffectiveEvent;
  const o = buildOpportunities([e]);
  assert.equal(o.length, 1);
  assert.equal(o[0].kind, "event");
  const now = new Date("2026-11-20T12:00:00Z");
  const b = pipelineBuckets(o, now);
  assert.equal(b.other.length, 1);
  assert.equal(b.active.length, 0);
  assert.equal(buildActions(o, now).filter((a) => a.kind === "offer_decision").length, 0, "the acceptance deadline passed weeks ago");
  const job = { ...e, subject: "Your offer", company: "Orbis", role: "Software Intern", signals: ["offer (ingestion)"] } as EffectiveEvent;
  assert.equal(buildOpportunities([job])[0].kind, "job", "a real job offer stays a job");
});

test("audit: dates bind to what they are about (quoted history, a competing offer, a promised update, a cancelled event)", () => {
  const o = opps([
    mail("Lena Park <lena.park@orbis.example>", "Next steps", "Hi Sam, we would like to invite you to interview. Please send your availability.", "2026-10-27T10:00:00Z", { thread: "h1" }),
    mail("Lena Park <lena.park@orbis.example>", "Re: Next steps", "Thanks Sam, understood.\n\nOn Tue, Oct 27, 2026 at 9:00 AM Sam <sam@campus.example> wrote:\n> My other offer expires on November 30 so I would appreciate a quick decision.", "2026-10-28T10:00:00Z", { thread: "h1" }),
    mail("Lena Park <lena.park@orbis.example>", "Re: Next steps", "Hi Sam, I will get back to you with an update by November 25.", "2026-11-19T10:00:00Z", { thread: "h1" }),
    mail("Orbis Calendar <calendar@orbis.example>", "Canceled event: Your Upcoming Virtual Interviews with Orbis @ Tue Nov 17, 2026 10am (PST)", "This event has been canceled.", "2026-11-16T10:00:00Z", { thread: "h2" }),
  ]);
  const dates = o.flatMap((x) => x.events.map((e) => e.eventDate?.toISOString().slice(0, 10)).filter(Boolean));
  assert.ok(!dates.includes("2026-11-30"), "the student's other offer deadline is not Orbis's");
  assert.ok(!dates.includes("2026-11-25"), "a promised update is not an interview date");
  assert.ok(!dates.includes("2026-11-17"), "a cancelled event has no date");
  const now = new Date("2026-11-19T12:00:00Z");
  assert.equal(o.every((x) => !nextMoment(x, now)), true);
});

test("audit: a job-alert digest is not an application; an application confirmation with an unsubscribe footer and a 'jobalerts' sender still is", () => {
  const digest = opps([mail("Job Board <alerts@board.example>", "Sports & Entertainment Jobs for You: Metro Jets", "Hi Sam, here are top job picks for you. Junior Software Developer at Metro Jets. Unsubscribe | Manage preferences", "2026-11-17T10:00:00Z")]);
  assert.equal(digest.length, 0);
  const real = opps([mail("Cisco-like <hiring@jobalerts.orbis.example>", "Your Orbis Journey Begins Here – Next Steps for Your Application", "Hi Sam, we have received your application for the Network Intern role. Next steps: our team will review it. Unsubscribe from job emails. 100 Main Street, Austin, TX 78701. © Orbis.", "2026-09-25T10:00:00Z")]);
  assert.ok(real.length >= 1, "the confirmation is kept");
});

test("audit: two applications to one employer stay independently addressable (distinct keys, nothing shadows)", () => {
  const o = opps([
    mail("Orbis Careers <careers@orbis.example>", "Thank you for applying to Orbis", "Hi Sam, thank you for applying to Orbis.", "2026-09-14T10:00:00Z", { thread: "c1" }),
    mail("Orbis Careers <careers@orbis.example>", "Thank you for applying to Orbis", "Hi Sam, thank you for applying to Orbis.", "2026-09-17T10:00:00Z", { thread: "c2" }),
  ]);
  const keys = new Set(o.map((x) => x.key));
  assert.equal(keys.size, o.length);
  for (const x of o) for (const k of x.legacyKeys ?? []) assert.ok(k === x.key || !keys.has(k));
});
