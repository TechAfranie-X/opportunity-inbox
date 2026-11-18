import assert from "node:assert/strict";
import test from "node:test";
import { check } from "../check.ts";
import { observe } from "../harness.ts";
import { LIFECYCLE_CASES } from "./cases.ts";

for (const c of LIFECYCLE_CASES) {
  const o = observe(c.events, c.company, c.now);
  for (const f of c.facets) {
    const tag = c.indeterminate ? " (indeterminate case: invariant only)" : "";
    test(`[${f.cat}] ${c.id}: ${f.kind}${"of" in f ? ` ${f.of}` : "a" in f ? ` ${f.a}/${f.b}` : ""} - ${f.why}${tag}`, () => check(c, o, f));
  }
}

// The contract for the dormancy decision (60 days, follow-up classification only) has no API yet: recorded as pending, never passing, never failing.
test("[dormancy] D01: a 60-day-silent application is classified dormant for follow-ups (still active, never closed)", { todo: "classification API arrives with the lifecycle reducer" }, () => {
  assert.fail("not implemented");
});
test("[dormancy] D04: newer evidence of any kind resets dormancy", { todo: "classification API arrives with the lifecycle reducer" }, () => {
  assert.fail("not implemented");
});
