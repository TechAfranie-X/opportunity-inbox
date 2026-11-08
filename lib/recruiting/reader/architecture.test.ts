import assert from "node:assert/strict";
import test from "node:test";
import type { RecruitingEmail } from "../types.ts";
import { STRESS_SET, stressEmail } from "./stress-set.ts";
import { CANDIDATE_QUERY_V2, triage } from "./triage.ts";
import type { VerifiedOutput } from "./types.ts";

const email = (over: Partial<RecruitingEmail> = {}): RecruitingEmail => ({ id: "m1", threadId: "t1", from: "Hiring <jobs@acme.example>", subject: "Hello", receivedAt: new Date("2026-03-01T10:00:00Z"), outbound: false, bodyText: "body", ...over });
const model = (over: Partial<VerifiedOutput> = {}): VerifiedOutput => ({ key: "k", status: "ok", recruiting: true, type: "status_update", stage: null, company: "Acme", companySource: "candidate", role: null, dateText: null, certainty: "high", evidence: { hash: "x", offset: 1 }, rejections: [], ...over });
const rules = (recruiting: boolean) => ({ recruiting, type: recruiting ? ("status_update" as const) : null, company: recruiting ? "Acme" : null, role: null });

// ---- triage: may only veto, never select ----
test("triage never vetoes a stress-set positive, including post-offer mail written without application vocabulary", () => {
  for (const c of STRESS_SET.filter((x) => x.yes)) assert.equal(triage(stressEmail(c)).pass, true, `${c.id} must reach the reader`);
});

test("triage vetoes provable commerce, order, security-code and digest mail with no hiring signal", () => {
  assert.equal(triage(email({ from: "Shop <deals@shop.example>", subject: "50% off everything", bodyText: "Free shipping on all orders. Unsubscribe." })).pass, false);
  assert.equal(triage(email({ from: "Bank <no-reply@bank.example>", subject: "Your verification code", bodyText: "Your one-time passcode is [num]." })).reason, "noise:security");
  assert.equal(triage(email({ subject: "Your order has shipped", bodyText: "Tracking number [num]. Out for delivery today." })).reason, "noise:order");
  assert.equal(triage(email({ subject: "Weekly digest", bodyText: "View this email in your browser. Manage preferences." })).reason, "noise:digest");
});

test("a hiring signal or an applicant-tracking sender protects a message from any veto", () => {
  const noisy = "50% off sale, free shipping, view in your browser";
  assert.equal(triage(email({ from: "Greenhouse <no-reply@greenhouse.io>", subject: "Update", bodyText: noisy })).reason, "protected");
  assert.equal(triage(email({ subject: "Your application", bodyText: noisy })).reason, "protected");
  assert.equal(triage(email({ subject: "Complete your onboarding", bodyText: `${noisy} background screening` })).pass, true);
});

test("unfamiliar mail passes by default: a new kind of recruiting mail is read, not dropped", () => {
  const r = triage(email({ from: "Zorp <hello@zorp.example>", subject: "Quick note", bodyText: "Let us know when you are free to chat." }));
  assert.deepEqual(r, { pass: true, reason: "unclassified" });
});

test("candidate query is semantic: it excludes Gmail's promotional categories and filters on no hiring words", () => {
  assert.match(CANDIDATE_QUERY_V2, /-category:promotions/);
  assert.match(CANDIDATE_QUERY_V2, /-category:social/);
  assert.match(CANDIDATE_QUERY_V2, /-category:forums/);
  assert.doesNotMatch(CANDIDATE_QUERY_V2, /subject:|interview|application|recruit/i);
});

// ---- pipeline composition ----
import { readFileSync } from "node:fs";
import { planRead, settle } from "./pipeline.ts";

test("the reading plan depends on the message alone and never on the rules or the gate", () => {
  assert.equal(planRead.length, 1, "planRead takes exactly one argument: the message");
  const src = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from "\.\/gate\.ts"/, "the frozen gate (which keys on the rules) is not part of v2");
  assert.doesNotMatch(src, /from "\.\.\/(extract|predictions)\.ts"/, "the rules are an input to settle(), never to planning");
});

test("mail without a hiring signal is not read; mail phrased in unfamiliar words is", () => {
  assert.equal(planRead(email({ subject: "50% off", bodyText: "Free shipping. Unsubscribe." })).read, false);
  const postOffer = STRESS_SET.find((c) => c.id === "o1")!;
  assert.equal(planRead(stressEmail(postOffer)).read, true);
});

test("settle: vetoed is not recruiting, unread-but-planned waits in review, otherwise the frozen consensus-and-review", () => {
  assert.equal(settle({ read: false, reason: "noise:order" }, rules(true), null).state, "not_recruiting");
  assert.equal(settle({ read: true, reason: "protected" }, rules(true), null).state, "review");
  assert.equal(settle({ read: true, reason: "protected" }, rules(true), model({ recruiting: true })).state, "recruiting");
  assert.equal(settle({ read: true, reason: "protected" }, rules(true), model({ recruiting: false })).state, "review", "disagreement is surfaced, not defaulted");
  assert.equal(settle({ read: true, reason: "unclassified" }, rules(false), model({ recruiting: false })).state, "not_recruiting");
});
