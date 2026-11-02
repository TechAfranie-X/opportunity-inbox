import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOpportunityEmail } from "./classify.ts";
import { applyThreadContext } from "./thread-context.ts";

test("thread context is unused when the current message is already resolved", () => {
  const input = {
    subject: "Your order has shipped",
    from: "store@shop.com",
  };
  const current = classifyOpportunityEmail(input);
  const next = applyThreadContext(input, current, [
    "Software Engineering Interview Scheduling",
  ]);

  assert.equal(current.label, "not_opportunity");
  assert.equal(next.label, "not_opportunity");
  assert.equal(next.matchedSignals.includes("thread:career-pipeline"), false);
});

test("ambiguous follow-up inherits strong pipeline evidence from the thread", () => {
  const input = {
    subject: "Re: Thursday works",
    from: "alex@company.com",
  };
  const current = classifyOpportunityEmail(input);

  assert.equal(current.label, "unknown");

  const next = applyThreadContext(input, current, [
    "Thursday works",
    "Software Engineering Interview Scheduling",
  ]);

  assert.equal(next.label, "opportunity");
  assert.ok(next.matchedSignals.includes("thread:career-pipeline"));
});

test("thread context does not invent a career signal from unrelated subjects", () => {
  const input = {
    subject: "Following up",
    from: "alex@company.com",
  };
  const current = classifyOpportunityEmail(input);
  const next = applyThreadContext(input, current, [
    "Following up",
    "Lunch tomorrow?",
  ]);

  assert.equal(current.label, "unknown");
  assert.equal(next.label, "unknown");
});
