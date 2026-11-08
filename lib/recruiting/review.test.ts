import assert from "node:assert/strict";
import test from "node:test";
import { extractAll } from "./extract.ts";
import { buildOpportunities } from "./opportunity.ts";
import { buildReviewQueue } from "./review.ts";
import { queryMatcher } from "../gmail/sample.ts";
import { RECRUITING_QUERY } from "../gmail/queries.ts";
import { buildSampleMailbox } from "./sample-mailbox.ts";

const matches = queryMatcher(RECRUITING_QUERY);
const events = () =>
  extractAll(buildSampleMailbox(new Date("2026-11-10T15:00:00Z")).filter((x) => x.email.outbound || matches(x.email)).map((x) => x.email)).map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));

test("the sample mailbox produces a review queue, and every item explains itself without message text", () => {
  const q = buildReviewQueue(buildOpportunities(events()));
  assert.ok(q.length >= 1, "vendor mail that never names the company must surface");
  for (const item of q) assert.ok(item.reasons.length > 0 && item.reasons.every((r) => r.length < 200));
});

test("a person's correction or confirmation removes an item from the queue", () => {
  const base = events();
  const first = buildReviewQueue(buildOpportunities(base));
  assert.ok(first.length >= 1);
  const target = first[0].event.id;
  const after = buildReviewQueue(buildOpportunities(base.map((e) => (e.id === target ? { ...e, corrected: true } : e))));
  assert.equal(after.some((i) => i.event.id === target), false);
  assert.equal(after.length, first.length - 1);
});

test("the queue never includes the user's own replies and lists active opportunities first", () => {
  const q = buildReviewQueue(buildOpportunities(events()));
  assert.ok(q.every((i) => !i.event.outbound));
});

test("pressing Looks right (confirmed) settles an item without changing any value", () => {
  const base = events();
  const first = buildReviewQueue(buildOpportunities(base));
  const target = first[0].event;
  const confirmed = base.map((e) => (e.id === target.id ? { ...e, confirmed: true } : e));
  const after = buildReviewQueue(buildOpportunities(confirmed));
  assert.equal(after.some((i) => i.event.id === target.id), false);
  const unchanged = buildOpportunities(confirmed).flatMap((o) => o.events).find((e) => e.id === target.id)!;
  assert.equal(unchanged.company, target.company);
  assert.equal(unchanged.type, target.type);
});

import { plainReason } from "./review.ts";
test("reasons shown to the person are sentences, not extractor labels", () => {
  assert.match(plainReason("company: sender is ats: not used as the employer"), /could not tell which employer/);
  assert.match(plainReason("company: weak evidence (sender_domain, display_name)"), /not confident about the company/);
  for (const r of ["type: low", "role: odd", "something else"]) assert.doesNotMatch(plainReason(r), /^(company|type|role):/);
});
