import assert from "node:assert/strict";
import test from "node:test";
import type { ReaderInput } from "../recruiting/reader/types.ts";
import type { ExtractedEvent } from "../recruiting/types.ts";
import { SEMANTIC_COMPANY_CONFIDENCE, reconcileReadings } from "./employer.ts";
import { APPROVAL_PHRASE, createHostedReader } from "./hosted.ts";
import { verifyReading, type RawReading } from "./reading.ts";

const input = (over: Partial<ReaderInput> & { subject: string; body: string }): ReaderInput => ({ key: "m1", from: "Talent Team @us.greenhouse-mail.io", received: "2026-11-10T15:00:00Z", threadMessages: 1, candidates: [], ...over });
const raw = (over: Partial<RawReading>): RawReading => ({ key: "m1", recruiting: "yes", event: { type: "recruiter_outreach", stage: "recruiter", quote: "invite you to a recruiter screen" }, entities: [], employer: null, role: null, deadline: null, certainty: "high", ...over });

const LYFT = input({ subject: "Update on your application", body: "Thank you for applying for the Software Engineer Intern position at Lyft. We would like to invite you to a recruiter screen." });
const lyftRaw = raw({ entities: [{ name: "Lyft", kind: "employer", quote: "position at Lyft" }], employer: { name: "Lyft", basis: "applied_to", quote: "applying for the Software Engineer Intern position at Lyft" }, role: { quote: "Software Engineer Intern" } });

test("an employer named by the message through an explicit relationship is accepted, with its role", () => {
  const v = verifyReading(lyftRaw, LYFT);
  assert.deepEqual(v.employer, { name: "Lyft", basis: "applied_to" });
  assert.equal(v.output.company, "Lyft");
  assert.equal(v.output.role, "Software Engineer Intern");
});

test("a quote that is not in the message, or does not name the employer, is an abstention", () => {
  assert.equal(verifyReading({ ...lyftRaw, employer: { name: "Lyft", basis: "applied_to", quote: "we are delighted by your Lyft application journey" } }, LYFT).employer, null);
  assert.equal(verifyReading({ ...lyftRaw, employer: { name: "Lyft", basis: "applied_to", quote: "Thank you for applying for the Software Engineer Intern position" } }, LYFT).employer, null);
  assert.equal(verifyReading({ ...lyftRaw, employer: { name: "Uber", basis: "applied_to", quote: "position at Uber is open" } }, LYFT).employer, null);
});

test("the transport is never the employer: assessment vendors, ATS vendors, job boards, agencies, people", () => {
  const i = input({ from: "Everpure Recruiting @hackerrank.com", subject: "Everpure Recruiting: Your HackerRank Early Career Coding Challenge Invitation", body: "You have been invited to take the Early Career Coding Challenge on HackerRank within 7 days." });
  for (const name of ["HackerRank", "Greenhouse", "LinkedIn"]) {
    const body = `${i.subject} ${i.body} Greenhouse LinkedIn`;
    const v = verifyReading(raw({ employer: { name, basis: "assessment_for", quote: `invited to take the Early Career Coding Challenge on ${name}` } }), { ...i, body });
    assert.equal(v.employer, null, name);
  }
  const agency = input({ subject: "Opportunity", body: "Robert Half is recruiting on behalf of a client for a Data Analyst Intern role." });
  assert.equal(verifyReading(raw({ employer: { name: "Robert Half", basis: "hiring_for", quote: "Robert Half is recruiting on behalf of" } }), agency).employer, null);
  const typed = verifyReading(raw({ event: { type: "assessment", stage: "assessment", quote: "invited to take the Early Career Coding Challenge" }, entities: [{ name: "HackerRank", kind: "assessment_vendor", quote: "on HackerRank" }, { name: "Everpure", kind: "employer", quote: "Everpure Recruiting" }], employer: { name: "Everpure", basis: "assessment_for", quote: "Everpure Recruiting: Your HackerRank Early Career Coding Challenge Invitation" } }), i);
  assert.equal(typed.employer?.name, "Everpure"); // an organization named in the subject with a stated relationship is accepted, as a hypothesis
  assert.equal(typed.entities.find((e) => e.name === "HackerRank")?.kind, "assessment_vendor");
});

test("'the sender is the employer' holds only for the employer's own domain", () => {
  const body = "Hi, this is the Neuralink recruiting team. We received your application for the Software Engineering Intern role.";
  const claim = raw({ event: { type: "applied", stage: "applied", quote: "We received your application" }, employer: { name: "Neuralink", basis: "sender_is_employer", quote: "this is the Neuralink recruiting team" } });
  assert.equal(verifyReading(claim, input({ from: "Neuralink Recruiting @us.greenhouse-mail.io", subject: "Application", body })).employer, null);
  assert.equal(verifyReading(claim, input({ from: "Neuralink Recruiting @neuralink.com", subject: "Application", body })).employer?.name, "Neuralink");
});

const event = (over: Partial<ExtractedEvent>): ExtractedEvent => ({ gmailMessageId: "m1", gmailThreadId: "t1", occurredAt: new Date("2026-11-10T15:00:00Z"), outbound: false, senderName: "x", senderDomain: "x.com", subject: "s", type: "recruiter_outreach", company: null, role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.3, fieldConfidence: { type: 0.6, company: 0.3, role: 0.3 }, signals: [], ...over });

test("reconciliation: a verified employer fills an unknown company as LIKELY and asks for confirmation", () => {
  const out = reconcileReadings([event({ role: null })], new Map([["m1", verifyReading(lyftRaw, LYFT)]]));
  assert.equal(out[0].company, "Lyft");
  assert.equal(out[0].fieldConfidence?.company, SEMANTIC_COMPANY_CONFIDENCE);
  assert.ok(SEMANTIC_COMPANY_CONFIDENCE < 0.6, "never as known");
  assert.ok(out[0].reviewReasons?.length);
  assert.equal(out[0].role, "Software Engineer Intern");
});

test("reconciliation: disagreement is never settled by the model alone", () => {
  const v = new Map([["m1", verifyReading(lyftRaw, LYFT)]]);
  const confident = reconcileReadings([event({ company: "Uber", fieldConfidence: { type: 0.8, company: 0.8, role: 0.5 } })], v)[0];
  assert.equal(confident.company, "Uber");
  assert.ok(confident.signals.includes("semantic:employer_conflict") && confident.reviewReasons?.length);
  const weak = reconcileReadings([event({ company: "Example", fieldConfidence: { type: 0.6, company: 0.3, role: 0.3 } })], v)[0];
  assert.equal(weak.company, "Lyft");
  assert.equal(weak.fieldConfidence?.company, SEMANTIC_COMPANY_CONFIDENCE);
  const agree = reconcileReadings([event({ company: "Lyft", fieldConfidence: { type: 0.8, company: 0.5, role: 0.5 } })], v)[0];
  assert.equal(agree.fieldConfidence?.company, 0.6);
});

test("reconciliation: no verified employer changes nothing; an abstention never writes", () => {
  const none = verifyReading(raw({ employer: null }), LYFT);
  const e = event({ company: "Uber" });
  assert.deepEqual(reconcileReadings([e], new Map([["m1", none]]))[0], e);
  assert.deepEqual(reconcileReadings([e], new Map([["m1", verifyReading(raw({ certainty: "low", employer: lyftRaw.employer }), LYFT)]]))[0], e);
});

test("the hosted reader is locked until approved, sends only minimized fields, caches verified results and treats failures as silence", async () => {
  assert.throws(() => createHostedReader({ transport: async () => "[]", env: {} }), /disabled/);
  let calls = 0;
  let sent = "";
  const reader = createHostedReader({
    env: { SEMANTIC_HOSTED_APPROVED: APPROVAL_PHRASE },
    transport: async ({ user }) => { calls++; sent = user; return JSON.stringify([lyftRaw]); },
  });
  const a = await reader.readings!([LYFT]);
  assert.equal(a.get("m1")?.employer?.name, "Lyft");
  assert.deepEqual(Object.keys(JSON.parse(sent)[0]).sort(), ["body", "employer_candidates", "from", "key", "received", "subject"]);
  await reader.readings!([LYFT]);
  assert.equal(calls, 1, "second read is served from the cache");
  const broken = createHostedReader({ env: { SEMANTIC_HOSTED_APPROVED: APPROVAL_PHRASE }, transport: async () => { throw new Error("network"); } });
  assert.equal((await broken.readings!([LYFT])).size, 0);
});

test("a semantic employer hypothesis is presented as likely, never as known and never as unknown", async () => {
  const { entityState } = await import("../recruiting/presentation.ts");
  const out = reconcileReadings([event({})], new Map([["m1", verifyReading(lyftRaw, LYFT)]]))[0];
  const asEffective = { ...out, id: "e1", corrected: false };
  assert.equal(entityState({ company: out.company!, events: [asEffective] }), "likely");
  assert.equal(entityState({ company: out.company!, events: [{ ...asEffective, confirmed: true }] }), "known");
  assert.equal(entityState({ company: "", events: [{ ...asEffective, company: null }] }), "unknown");
});

test("a company the rules took from an agency or assessment platform is dropped, and replaced only by a verified employer", () => {
  const i = input({ from: "Dana Reyes @searchlight-partners.com", subject: "Introducing you to Anthropic", body: "Hello Sam, Searchlight Partners is helping Anthropic hire interns for the research engineering team." });
  const q = "Searchlight Partners is helping Anthropic hire interns";
  const withEmployer = verifyReading(raw({ event: { type: "recruiter_outreach", stage: "recruiter", quote: q }, entities: [{ name: "Searchlight Partners", kind: "recruiting_agency", quote: "Searchlight Partners" }], employer: { name: "Anthropic", basis: "hiring_for", quote: q } }), i);
  const rules = event({ company: "Sam Searchlight Partners", fieldConfidence: { type: 0.6, company: 0.7, role: 0.3 } });
  const out = reconcileReadings([rules], new Map([["m1", withEmployer]]))[0];
  assert.equal(out.company, "Anthropic");
  assert.equal(out.fieldConfidence?.company, SEMANTIC_COMPANY_CONFIDENCE);
  const noEmployer = verifyReading(raw({ event: { type: "recruiter_outreach", stage: "recruiter", quote: q }, entities: [{ name: "Searchlight Partners", kind: "recruiting_agency", quote: "Searchlight Partners" }], employer: null }), i);
  assert.equal(reconcileReadings([rules], new Map([["m1", noEmployer]]))[0].company, null);
});
