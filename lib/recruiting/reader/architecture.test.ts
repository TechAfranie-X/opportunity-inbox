import assert from "node:assert/strict";
import test from "node:test";
import type { RecruitingEmail } from "../types.ts";
import { ADJUDICATION_VERSION, ADJ_BODY_CHARS, buildAdjudicationInput, buildClaims, verifyAdjudication, type AdjudicationInput, type VerifiedAdjudication } from "./adjudicate.ts";
import { needsAdjudication, resolve } from "./resolve.ts";
import { STRESS_SET, stressEmail } from "./stress-set.ts";
import { CANDIDATE_QUERY_V2, triage } from "./triage.ts";
import type { VerifiedOutput } from "./types.ts";

const email = (over: Partial<RecruitingEmail> = {}): RecruitingEmail => ({ id: "m1", threadId: "t1", from: "Hiring <jobs@acme.example>", subject: "Hello", receivedAt: new Date("2026-03-01T10:00:00Z"), outbound: false, bodyText: "body", ...over });
const model = (over: Partial<VerifiedOutput> = {}): VerifiedOutput => ({ key: "k", status: "ok", recruiting: true, type: "status_update", stage: null, company: "Acme", companySource: "candidate", role: null, dateText: null, certainty: "high", evidence: { hash: "x", offset: 1 }, rejections: [], ...over });
const rules = (recruiting: boolean) => ({ recruiting, type: recruiting ? ("status_update" as const) : null, company: recruiting ? "Acme" : null, role: null });
const adjInput = (over: Partial<AdjudicationInput> = {}): AdjudicationInput => ({ key: "k", from: "Acme @acme.example", subject: "Welcome", body: "Please complete your background screening today.", received: "2026-03-01T10:00:00Z", thread: [], claims: [], ...over });
const adj = (over: Partial<VerifiedAdjudication> = {}): VerifiedAdjudication => ({ key: "k", status: "ok", verdict: "yes", reason: "hire_completion_step", certainty: "high", evidence: { hash: "h", offset: 3 }, rejections: [], ...over });

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

// ---- adjudication input ----
test("adjudication input is redacted, bounded, and keeps thread context short", () => {
  const long = "x ".repeat(5000);
  const inp = buildAdjudicationInput(
    email({ bodyText: `Hi Sam, see https://example.com/a?b=1 or mail me@example.com ${long}`, subject: "Hi Sam" }),
    "k",
    [email({ id: "a", receivedAt: new Date("2026-02-01"), subject: "Earlier", bodyText: "y".repeat(500) }), email({ id: "b", receivedAt: new Date("2026-02-02"), outbound: true }), email({ id: "c" }), email({ id: "d", receivedAt: new Date("2026-02-03") }), email({ id: "e", receivedAt: new Date("2026-02-04") })],
    [],
    ["Sam"],
  );
  assert.ok(inp.body.length <= ADJ_BODY_CHARS);
  assert.doesNotMatch(inp.body, /https?:|@example|Sam/);
  assert.match(inp.body, /\[link\]/);
  assert.equal(inp.subject, "Hi [candidate]");
  assert.ok(inp.thread.length <= 3);
  assert.ok(inp.thread.every((t) => t.snippet.length <= 160));
  assert.ok(inp.thread.some((t) => t.from === "(the recipient)"), "the user's own replies are described, not named");
});

test("claims are ordered by the key's hash, deterministically, and carry the right content", () => {
  const a = buildClaims("key-1", { recruiting: true, type: "assessment", signals: ["interview confirmed"] }, model({ recruiting: false }));
  const again = buildClaims("key-1", { recruiting: true, type: "assessment", signals: ["interview confirmed"] }, model({ recruiting: false }));
  assert.deepEqual(a, again);
  const orders = new Set(Array.from({ length: 40 }, (_, i) => buildClaims(`k${i}`, { recruiting: true, type: null, signals: [] }, model())[0].reader));
  assert.equal(orders.size, 2, "neither reader is always first");
  const pattern = a.find((c) => c.reader === "pattern matcher")!;
  assert.equal(pattern.says, "recruiting");
  assert.match(pattern.basis, /interview confirmed/);
  assert.equal(a.find((c) => c.reader === "language model")!.says, "not recruiting");
  assert.equal(buildClaims("k", { recruiting: false, type: null, signals: [] }, model({ certainty: "low" })).find((c) => c.reader === "language model")!.says, "could not decide");
});

// ---- adjudication verification ----
test("a verdict stands only with a consistent reason and a verbatim quote", () => {
  const i = adjInput();
  const ok = verifyAdjudication({ key: "k", verdict: "yes", reason: "hire_completion_step", evidence_quote: "complete your background screening", certainty: "high" }, i);
  assert.equal(ok.status, "ok");
  assert.equal(ok.verdict, "yes");
  assert.ok(ok.evidence && ok.evidence.offset >= 0);
  assert.equal(JSON.stringify(ok).includes("background"), false, "the quote itself is never retained");

  const notInText = verifyAdjudication({ key: "k", verdict: "yes", reason: "own_hiring_process", evidence_quote: "you got the job", certainty: "high" }, i);
  assert.equal(notInText.status, "unsupported");
  assert.equal(notInText.verdict, "unsure");

  assert.equal(verifyAdjudication({ key: "k", verdict: "no", reason: "own_hiring_process", evidence_quote: "background screening", certainty: "high" }, i).status, "invalid");
  assert.equal(verifyAdjudication({ key: "k", verdict: "yes", reason: "not_employment", evidence_quote: "background screening", certainty: "high" }, i).status, "invalid");
  assert.equal(verifyAdjudication({ key: "other", verdict: "yes", reason: "own_hiring_process", evidence_quote: "background screening", certainty: "high" }, i).status, "invalid");
  assert.equal(verifyAdjudication({ key: "k", verdict: "yes", reason: "own_hiring_process", evidence_quote: "  ", certainty: "high" }, i).status, "unsupported");
  assert.equal(verifyAdjudication("not an object", i).status, "invalid");
  assert.equal(verifyAdjudication({ key: "k", verdict: "unsure", reason: "cannot_tell", evidence_quote: null, certainty: "low" }, i).verdict, "unsure");
});

test("a quote may come from thread context, but not from claims or invented text", () => {
  const i = adjInput({ thread: [{ from: "(the recipient)", subject: "Re: Welcome", snippet: "Happy to share my start availability" }], claims: [{ reader: "pattern matcher", says: "recruiting", basis: "matched zebra phrase" }] });
  assert.equal(verifyAdjudication({ key: "k", verdict: "yes", reason: "hire_completion_step", evidence_quote: "share my start availability", certainty: "medium" }, i).status, "ok");
  assert.equal(verifyAdjudication({ key: "k", verdict: "yes", reason: "hire_completion_step", evidence_quote: "matched zebra phrase", certainty: "medium" }, i).status, "unsupported");
});

test("the adjudication version changes when the guide or output spec changes", () => {
  assert.match(ADJUDICATION_VERSION, /^adj-[0-9a-f]{12}$/);
});

// ---- resolution v2 ----
test("agreeing readers are accepted with no adjudication, using the frozen field logic", () => {
  const r = resolve(rules(true), model({ recruiting: true }), null);
  assert.equal(r.state, "recruiting");
  assert.equal(r.basis, "agree");
  assert.equal(r.needsAdjudication, false);
  assert.equal(resolve(rules(false), model({ recruiting: false }), null).state, "not_recruiting");
});

test("disagreement waits in review until a verified verdict exists, in either direction", () => {
  for (const [r, m] of [[rules(true), model({ recruiting: false })], [rules(false), model({ recruiting: true })]] as const) {
    assert.equal(needsAdjudication(r, m), true);
    const pending = resolve(r, m, null);
    assert.equal(pending.state, "review");
    assert.equal(pending.basis, "unresolved");
  }
});

test("a model abstention is adjudicated, never silently resolved by the rules", () => {
  const abstain = model({ certainty: "low" });
  assert.equal(needsAdjudication(rules(true), abstain), true);
  assert.equal(needsAdjudication(rules(false), model({ status: "invalid" })), true);
  assert.equal(resolve(rules(true), abstain, null).state, "review");
});

test("a verified verdict decides, whichever reader it contradicts", () => {
  const yes = resolve(rules(false), model({ recruiting: true, company: "Acme", type: "status_update" }), adj({ verdict: "yes" }));
  assert.equal(yes.state, "recruiting");
  assert.equal(yes.basis, "adjudicated");
  assert.equal(yes.company, "Acme");
  assert.equal(yes.companyReview, true, "fields supported by one reader only are flagged");
  assert.equal(yes.typeReview, true);

  const no = resolve(rules(true), model({ recruiting: false }), adj({ verdict: "no", reason: "not_employment" }));
  assert.equal(no.state, "not_recruiting");
  assert.equal(no.basis, "adjudicated");
  assert.equal(no.company, null);
});

test("an adjudicated yes that only the rules supported takes the rules' fields, flagged", () => {
  const r = resolve({ recruiting: true, type: "assessment", company: "Initech", role: "Analyst" }, model({ recruiting: false }), adj({ verdict: "yes", reason: "own_hiring_process" }));
  assert.equal(r.state, "recruiting");
  assert.equal(r.company, "Initech");
  assert.equal(r.role, "Analyst");
  assert.equal(r.roleReview, true);
});

test("unsure, low-certainty, unsupported or invalid adjudications leave the message in review", () => {
  const m = model({ recruiting: false });
  for (const a of [adj({ verdict: "unsure", reason: null }), adj({ certainty: "low" }), adj({ status: "unsupported" }), adj({ status: "invalid" })]) {
    const r = resolve(rules(true), m, a);
    assert.equal(r.state, "review");
    assert.equal(r.basis, "unresolved");
  }
});

test("a message the model never read is not adjudicated and keeps the frozen behavior", () => {
  assert.equal(needsAdjudication(rules(true), null), false);
  assert.equal(resolve(rules(false), null, null).state, "not_recruiting");
});

// ---- pipeline composition ----
import { readFileSync } from "node:fs";
import { planRead, settle } from "./pipeline.ts";

test("the reading plan depends on the message alone and never on the rules or the gate", () => {
  assert.equal(planRead.length, 1, "planRead takes exactly one argument: the message");
  const src = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from "\.\/gate\.ts"/, "the frozen gate (which keys on the rules) is not part of v2");
  assert.doesNotMatch(src, /from "\.\.\/(extract|predictions)\.ts"/, "the rules are an input to settle(), never to planning");
  const imports = src.split("\n").filter((l) => l.startsWith("import ")).join("\n");
  assert.doesNotMatch(imports, /adjudicate|\.\/resolve\.ts/, "the rejected adjudicator is not wired in");
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
