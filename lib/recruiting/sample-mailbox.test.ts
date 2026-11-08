import assert from "node:assert/strict";
import test from "node:test";
import { queryMatcher } from "../gmail/sample.ts";
import { RECRUITING_QUERY } from "../gmail/queries.ts";
import { buildActions, toFloating } from "./actions.ts";
import { buildBriefing } from "./briefing.ts";
import { extractAll } from "./extract.ts";
import { buildOpportunities } from "./opportunity.ts";
import { buildSampleMailbox, type SampleEmail } from "./sample-mailbox.ts";

const ANCHOR = new Date("2026-11-10T15:00:00Z");
const box = () => buildSampleMailbox(ANCHOR);
const matches = queryMatcher(RECRUITING_QUERY);

test("the sample mailbox is deterministic and large enough to be realistic", () => {
  const a = box(), b = box();
  assert.deepEqual(a.map((x) => x.email.id), b.map((x) => x.email.id));
  assert.deepEqual(a.map((x) => x.email.subject), b.map((x) => x.email.subject));
  assert.ok(a.length >= 100, `${a.length} emails`);
  assert.equal(new Set(a.map((x) => x.email.id)).size, a.length, "ids are unique");
  assert.ok(a.some((x) => x.email.outbound), "includes the user's own replies");
});

test("it contains no real address: every sender is a synthetic or generic one", () => {
  for (const x of box()) assert.doesNotMatch(x.email.from, /@(gmail|outlook|yahoo|icloud|hotmail)\./i);
});

test("the Gmail search emulation is read from the real query and matches recruiting mail while skipping unrelated mail", () => {
  assert.equal(matches({ from: "x <a@b.com>", subject: "Thank you for applying to Acme" }), true);
  assert.equal(matches({ from: "Workday <noreply@myworkday.com>", subject: "Hello" }), true, "applicant-tracking senders match on the sender");
  assert.equal(matches({ from: "Nike <deals@nike.com>", subject: "Our best offer: 50% off ends tonight" }), true, "'offer' is a search keyword, so promotions reach the extractor, which must reject them");
  assert.equal(matches({ from: "Google <no-reply@accounts.google.com>", subject: "Security alert" }), false);
});

test("the extractor recovers the planted truth: recruiting mail found, noise rejected", () => {
  const all = box();
  const candidates = all.filter((x) => x.email.outbound || matches(x.email));
  const events = extractAll(candidates.map((x) => x.email));
  const byId = new Map(events.map((e) => [e.gmailMessageId, e]));
  const certain = candidates.filter((x) => !x.uncertain);
  // A reply can only be recognized when the recruiter's message it answers was fetched (the extractor anchors replies on it).
  const anchored = (x: SampleEmail) => !x.email.outbound || candidates.some((y) => !y.email.outbound && y.email.threadId === x.email.threadId && y.expected.type !== null);
  const wantEvent = certain.filter((x) => x.expected.type !== null && anchored(x));
  const found = wantEvent.filter((x) => byId.has(x.email.id));
  const recall = found.length / wantEvent.length;
  const noise = certain.filter((x) => x.expected.type === null);
  const leaked = noise.filter((x) => byId.has(x.email.id));
  assert.ok(recall >= 0.97, `recall ${(recall * 100).toFixed(1)}% (${found.length}/${wantEvent.length})`);
  assert.equal(leaked.length, 0, `noise leaked: ${leaked.map((x) => x.email.subject).join(" | ")}`);
  const typeOk = found.filter((x) => byId.get(x.email.id)!.type === x.expected.type).length / found.length;
  const companyKnown = found.filter((x) => x.expected.company);
  const companyOk = companyKnown.filter((x) => byId.get(x.email.id)!.company === x.expected.company).length / companyKnown.length;
  assert.ok(typeOk >= 0.97, `type accuracy ${(typeOk * 100).toFixed(1)}%`);
  assert.ok(companyOk >= 0.97, `company accuracy ${(companyOk * 100).toFixed(1)}%`);
});

test("it reconstructs distinct opportunities, including a re-application as a second opportunity", () => {
  const events = extractAll(box().filter((x) => x.email.outbound || matches(x.email)).map((x) => x.email)).map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
  const opps = buildOpportunities(events);
  assert.ok(opps.length >= 35, `${opps.length} opportunities`);
  const scale = opps.filter((o) => o.company === "Jane Street" || o.company === "Two Sigma" || o.company === "Samsara");
  assert.ok(scale.length >= 3);
  const reapplied = opps.filter((o) => o.company === "Plaid" || o.company === "Rippling" || o.company === "Okta");
  assert.ok(opps.some((o) => opps.filter((x) => x.company === o.company).length >= 2), "a company with two opportunities (rejected, then re-applied)");
  assert.ok(reapplied.length >= 1);
});

test("Today has real variety: something due now, something coming up, and quiet nudges", () => {
  const events = extractAll(box().filter((x) => x.email.outbound || matches(x.email)).map((x) => x.email)).map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
  const now = toFloating(ANCHOR);
  const opps = buildOpportunities(events);
  const briefing = buildBriefing(opps, buildActions(opps, now), now);
  assert.ok(briefing.needsYou.length >= 2, `needsYou ${briefing.needsYou.length}`);
  assert.ok(briefing.comingUp.length >= 1, `comingUp ${briefing.comingUp.length}`);
  assert.ok(briefing.waiting.length >= 1, `waiting ${briefing.waiting.length}`);
  const kinds = new Set(briefing.needsYou.concat(briefing.comingUp).map((a) => a.kind));
  assert.ok(kinds.size >= 3, `varied actions: ${[...kinds].join(", ")}`);
});

test("vendor mail that never names the company is present and is NOT guessed", () => {
  const unclear = box().filter((x: SampleEmail) => x.uncertain);
  assert.ok(unclear.length >= 3);
  const events = extractAll(unclear.map((x) => x.email));
  for (const e of events) assert.ok(!e.company || (e.fieldConfidence?.company ?? 1) < 0.6, `guessed ${e.company}`);
});

test("the keyword search's real recall gap is visible in the sample, not hidden: a recruiter email without a keyword is never fetched", () => {
  const all = box();
  const missed = all.filter((x) => !x.email.outbound && x.expected.type !== null && !matches(x.email));
  assert.ok(missed.length >= 1, "at least one planted recruiting email is invisible to the product's search");
  assert.ok(missed.some((x) => /quick chat/i.test(x.email.subject)), "the hand-written Datadog recruiter email (no keyword in its subject)");
  const orphan = all.find((x) => x.email.outbound && x.email.threadId === "t-dd-rec");
  assert.ok(orphan, "and its reply exists, orphaned, exactly as it would in a real mailbox");
});
