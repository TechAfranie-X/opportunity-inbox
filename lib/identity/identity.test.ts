import assert from "node:assert/strict";
import test from "node:test";
import type { EffectiveEvent, ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import type { ReaderInput } from "../recruiting/reader/types.ts";
import { verifyReading, type RawReading } from "../semantic/reading.ts";
import { canonicalOrg, coreName, isTeamName, lookup, orgsAtDomain, registrable } from "./graph.ts";
import { learnedMappings } from "./learned.ts";
import { applyIdentity } from "./reconcile.ts";
import { brandFor } from "./resolve.ts";
import { notEmployerReason, resolveIdentity } from "./resolver.ts";

const GH = "Talent Team <no-reply@us.greenhouse-mail.io>";

test("graph: team and function words are stripped, brands recruit through their parent, kinds are known", () => {
  assert.equal(coreName("Meta University Recruiting"), "Meta");
  assert.equal(coreName("Jane Street Campus Recruiting"), "Jane Street");
  assert.equal(coreName("Everpure Recruiting"), "Everpure");
  assert.equal(coreName("Acme, Inc."), "Acme");
  assert.ok(isTeamName("Everpure Recruiting") && !isTeamName("Everpure"));
  assert.equal(canonicalOrg(lookup("Amazon Web Services")!).name, "Amazon");
  assert.equal(lookup("Greenhouse")?.kind, "ats");
  assert.equal(lookup("HackerRank")?.kind, "assessment");
  assert.equal(lookup("Robert Half")?.kind, "agency");
  assert.equal(registrable("careers.us.example.co.uk"), "example.co.uk");
  assert.ok(orgsAtDomain("datadoghq.com").some((o) => o.name === "Datadog"));
});

test("a team name is not the employer, and the sending platform is named as an intermediary", () => {
  const r = resolveIdentity({ from: "Everpure Recruiting <no-reply@hackerrank.com>", subject: "Everpure Recruiting: Your HackerRank Early Career Coding Challenge Invitation", body: "Hi, you have been invited to take the Early Career Coding Challenge." });
  assert.equal(r.employer?.name, "Everpure");
  assert.equal(r.state, "likely", "a vendor-stamped team name alone is a hypothesis");
  assert.ok(r.intermediaries.some((i) => i.name === "HackerRank" && i.kind === "assessment"));
  assert.equal(r.team, "Everpure Recruiting");
});

test("independent evidence converges to known: the employer's own domain plus the text", () => {
  const r = resolveIdentity({ from: "Meta University Recruiting <university@meta.com>", subject: "Your application to the Software Engineer Intern role", body: "Thank you for applying to Meta." });
  assert.equal(r.employer?.name, "Meta");
  assert.equal(r.state, "known");
});

test("agencies, vendors, generic words and people are never the employer", () => {
  for (const n of ["Robert Half", "Kforce", "TalentBridge Staffing", "Greenhouse", "HackerRank Tests", "Opportunity", "Recruiter", "Candidate Care"]) assert.notEqual(notEmployerReason(n), null, n);
  assert.equal(notEmployerReason("Datadog"), null);
  const r = resolveIdentity({ from: "Dana Reyes at Robert Half <dreyes@roberthalf.com>", subject: "A role", body: "Robert Half is recruiting for a client." });
  assert.equal(r.employer, null);
  assert.ok(r.intermediaries.some((i) => i.name === "Robert Half" && i.kind === "agency"));
});

test("an agency acting for a named client: the client is the employer, only with a verified relationship", () => {
  const input: ReaderInput = { key: "m", from: "Robert Half @roberthalf.com", subject: "Robert Half recruiting for Stripe", body: "I am recruiting for Stripe on a Data Analyst Intern role.", received: "2026-11-10T00:00:00Z", threadMessages: 1, candidates: [] };
  const raw: RawReading = { key: "m", recruiting: "yes", event: { type: "recruiter_outreach", stage: "recruiter", quote: "I am recruiting for Stripe on a Data Analyst Intern role" }, entities: [{ name: "Robert Half", kind: "recruiting_agency", quote: "Robert Half" }], employer: { name: "Stripe", basis: "hiring_for", quote: "I am recruiting for Stripe on a Data Analyst Intern role" }, role: null, deadline: null, certainty: "high" };
  const semantic = verifyReading(raw, input);
  const r = resolveIdentity({ from: "Robert Half <dreyes@roberthalf.com>", subject: input.subject, body: input.body, semantic });
  assert.equal(r.employer?.name, "Stripe");
  assert.ok(r.intermediaries.some((i) => i.name === "Robert Half"));
  assert.equal(resolveIdentity({ from: "Robert Half <dreyes@roberthalf.com>", subject: input.subject, body: input.body }).employer, null, "without the reading, nothing is invented");
});

test("ordinary-word names need more than one signal", () => {
  const one = resolveIdentity({ from: GH, subject: "Update", body: "Thank you for applying to Scale for the Operations Intern role." });
  assert.notEqual(one.state, "known");
  const two = resolveIdentity({ from: "Scale AI Recruiting <recruiting@scale.com>", subject: "Interview confirmation", body: "Your interview at Scale AI is confirmed." });
  assert.equal(two.employer?.name.toLowerCase().startsWith("scale"), true);
});

test("a company seen only through a generic mail channel is not invented", () => {
  const r = resolveIdentity({ from: "Hiring <hiring@jobs-notify.io>", subject: "We received your application", body: "Our team will be in touch." });
  assert.equal(r.employer, null);
  assert.equal(r.state, "unknown");
});

test("conflicting plausible employers go to review, not to a guess", () => {
  const r = resolveIdentity({ from: "Careers <careers@fernhill.com>", subject: "Your interview with Brightwave", body: "Thanks for applying to Fernhill. Your Brightwave interview is Monday." });
  assert.ok(r.state === "review" || r.state === "likely");
  if (r.state === "review") assert.ok(r.alternative);
});

test("learned mappings: own confirmations only, never from shared senders, conflicts dropped", () => {
  const ev = (over: Partial<EffectiveEvent>): EffectiveEvent => ({ id: "e", gmailMessageId: "m", gmailThreadId: "t", occurredAt: new Date(), outbound: false, senderName: "Quillhaven Recruiting", senderDomain: "quillhaven.io", subject: "s", type: "applied", company: "Quillhaven", role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.5, signals: [], corrected: false, confirmed: true, ...over });
  const learned = learnedMappings([
    ev({}),
    ev({ senderDomain: "us.greenhouse-mail.io", senderName: "Talent Team", company: "Acme" }), // shared sender: nothing is learned from the domain
    ev({ senderDomain: "gmail.com", senderName: "Jordan Lee", company: "Coinbase" }),
    ev({ senderDomain: "conflict.io", senderName: "Conflict Co", company: "A" }),
    ev({ senderDomain: "conflict.io", senderName: "Conflict Co", company: "B" }), // two companies for one domain: dropped
    ev({ confirmed: false, corrected: false, senderDomain: "unconfirmed.io", senderName: "Unconfirmed", company: "Z" }),
  ]);
  assert.equal(learned.byDomain.get("quillhaven.io"), "Quillhaven");
  assert.equal(learned.byDomain.has("greenhouse-mail.io"), false);
  assert.equal(learned.byDomain.has("gmail.com"), false);
  assert.equal(learned.byDomain.has("conflict.io"), false);
  assert.equal(learned.byDomain.has("unconfirmed.io"), false);
  assert.equal(learned.byDisplay.has("jordanlee"), false, "a person's name is never a key");
  // and it is applied, as high-weight evidence, to the next message from that sender
  const r = resolveIdentity({ from: "Quillhaven Recruiting <jobs@quillhaven.io>", subject: "Next steps", body: "Please share your availability.", learned });
  assert.equal(r.employer?.name, "Quillhaven");
  assert.equal(r.state, "known");
  // a mapping never leaks to another sender
  assert.notEqual(resolveIdentity({ from: "Someone <a@other.io>", subject: "Next steps", body: "Please share your availability.", learned }).employer?.name, "Quillhaven");
});

const mail = (over: Partial<RecruitingEmail>): RecruitingEmail => ({ id: "m1", threadId: "t1", from: "Everpure Recruiting <no-reply@hackerrank.com>", subject: "Everpure Recruiting: Your HackerRank Early Career Coding Challenge Invitation", receivedAt: new Date("2026-11-10T15:00:00Z"), outbound: false, bodyText: "You have been invited to take the Early Career Coding Challenge.", ...over });
const event = (over: Partial<ExtractedEvent>): ExtractedEvent => ({ gmailMessageId: "m1", gmailThreadId: "t1", occurredAt: new Date("2026-11-10T15:00:00Z"), outbound: false, senderName: "Everpure Recruiting", senderDomain: "hackerrank.com", subject: "s", type: "assessment", company: null, role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.5, fieldConfidence: { type: 0.7, company: 0.3, role: 0 }, signals: [], ...over });

test("reconcile: a likely employer is written as likely with a plain reason; a vetoed vendor guess is withdrawn; a confident rules reading is not overturned silently", () => {
  const ctx = { known: [], learned: learnedMappings([]) };
  const likely = applyIdentity([event({})], new Map([["m1", mail({})]]), new Map(), ctx)[0];
  assert.equal(likely.company, "Everpure");
  assert.ok((likely.fieldConfidence?.company ?? 1) < 0.6);
  assert.match((likely.reviewReasons ?? []).join(" "), /HackerRank.*not the employer.*Everpure/);
  const vetoed = applyIdentity([event({ company: "HackerRank Tests", fieldConfidence: { type: 0.7, company: 0.5, role: 0 } })], new Map([["m1", mail({ from: "HackerRank Tests <support@hackerrank.com>", subject: "Reminder", bodyText: "Your test expires soon." })]]), new Map(), ctx)[0];
  assert.equal(vetoed.company, null);
  const confident = applyIdentity([event({ company: "Uber", fieldConfidence: { type: 0.8, company: 0.8, role: 0 } })], new Map([["m1", mail({})]]), new Map(), ctx)[0];
  assert.equal(confident.company, "Uber");
  assert.ok(confident.signals.includes("identity:conflict"));
});

test("logos follow canonical identity: the resolved company, never the other way round", () => {
  const r = resolveIdentity({ from: "Amazon Web Services Recruiting <aws-recruiting@amazon.com>", subject: "Next steps", body: "We would like to schedule a phone screen for the Cloud Support Engineer Intern role." });
  assert.equal(r.employer?.name, "Amazon");
  assert.equal(brandFor(r.employer?.name)?.key, "amazon");
  assert.equal(brandFor("Everpure"), null, "no logo is invented for a company without a public mark");
});
