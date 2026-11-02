import assert from "node:assert/strict";
import test from "node:test";
import { deriveProduct } from "./product.ts";
import { extractAll } from "./extract.ts";
import type { RecruitingEmail } from "./types.ts";

const mail = (id: string, thread: string, from: string, subject: string, body: string, day: number): RecruitingEmail => ({ id, threadId: thread, from, subject, bodyText: body, receivedAt: new Date(Date.UTC(2026, 2, day, 12)), outbound: false });

test("the product groups same-company mail and surfaces an assessment due today", () => {
  const events = extractAll([
    mail("a1", "t1", "Acme Recruiting <jobs@acme.com>", "Thank you for applying to Acme", "We received your application for the Software Engineer Intern role.", 1),
    mail("a2", "t2", "Acme Recruiting <jobs@acme.com>", "Your Acme online assessment", "Please complete your coding assessment by March 10, 2026 11:59 PM.", 5),
    mail("b1", "t3", "Beta Careers <jobs@beta.io>", "Thank you for applying to Beta", "We received your application for the Data Analyst role.", 2),
  ]);
  const asOf = new Date(Date.UTC(2026, 2, 10, 9, 0));
  const { groups, todayThreads } = deriveProduct(events, asOf);
  assert.equal(groups.get("a1"), groups.get("a2"));
  assert.notEqual(groups.get("a1"), groups.get("b1"));
  assert.ok(todayThreads.has("t2"));
  assert.ok(!todayThreads.has("t3"));
});
