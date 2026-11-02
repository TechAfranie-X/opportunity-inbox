import assert from "node:assert/strict";
import test from "node:test";
import { buildPredictions } from "./predictions.ts";
import type { RecruitingEmail } from "./types.ts";
import { EXTRACTOR_VERSION } from "./version.ts";

const mail = (id: string, thread: string, from: string, subject: string, body: string, outbound = false): RecruitingEmail => ({
  id, threadId: thread, from, subject, body: undefined as never, bodyText: body, receivedAt: new Date("2026-03-01T12:00:00Z"), outbound,
}) as RecruitingEmail;

const emails = [
  mail("m1", "t1", "Acme Recruiting <jobs@acme.com>", "Your Acme online assessment", "Please complete your coding assessment by March 5, 2026."),
  mail("m2", "t2", "Shop <deals@shop.example>", "Weekend sale", "Everything is 20% off. Unsubscribe any time."),
  mail("m3", "t3", "Acme <no-reply@acme.com>", "Verification code", "Your security code is 123456"),
  mail("m4", "t1", "me@example.com", "Re: Your Acme online assessment", "Thanks, will do.", true),
  mail("m5", "t9", "me@example.com", "Dinner plans", "See you at 7", true),
];

test("every scanned inbound message gets exactly one prediction, recruiting or not", () => {
  const p = buildPredictions(emails);
  const ids = p.map((x) => x.gmailMessageId).sort();
  assert.deepEqual(ids, ["m1", "m2", "m3", "m4"]); // m5 is outbound outside any recruiting thread: not a decision
  const by = Object.fromEntries(p.map((x) => [x.gmailMessageId, x]));
  assert.equal(by.m1.decision, "recruiting");
  assert.equal(by.m1.type, "assessment");
  assert.equal(by.m2.decision, "not_recruiting");
  assert.equal(by.m3.decision, "not_recruiting");
  assert.equal(by.m4.decision, "recruiting"); // outbound reply in a recruiting thread
  assert.equal(by.m4.outbound, true);
});

test("negative predictions record why, and carry no subject, company or body", () => {
  const neg = buildPredictions(emails).filter((x) => x.decision === "not_recruiting");
  assert.ok(neg.length >= 2);
  for (const n of neg) {
    assert.match(n.signals[0], /^rejected:/);
    assert.equal(n.type, null);
    assert.equal(n.company, null);
    assert.equal(n.confidence, null);
    assert.equal("subject" in n, false);
    assert.equal("bodyText" in n, false);
  }
  assert.equal(neg.find((x) => x.gmailMessageId === "m3")?.signals[0], "rejected:transactional");
});

test("predictions are stamped with the extractor version and are deterministic", () => {
  const a = buildPredictions(emails);
  const b = buildPredictions(emails);
  assert.deepEqual(a, b);
  assert.ok(a.every((x) => x.extractorVersion === EXTRACTOR_VERSION));
  assert.equal(buildPredictions(emails, "test-1")[0].extractorVersion, "test-1");
});

test("the recruiting predictions agree with the events the product shows", () => {
  const p = buildPredictions(emails).filter((x) => x.decision === "recruiting");
  assert.deepEqual(p.map((x) => x.gmailMessageId).sort(), ["m1", "m4"]);
});

test("a duplicated message id is predicted once", () => {
  assert.equal(buildPredictions([emails[1], emails[1]]).length, 1);
});
