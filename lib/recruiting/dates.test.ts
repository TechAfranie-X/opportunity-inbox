import assert from "node:assert/strict";
import test from "node:test";
import { pickDate } from "./dates.ts";

const received = new Date(Date.UTC(2026, 10, 1, 10)); // Sun Nov 1 2026

function iso(m: ReturnType<typeof pickDate>) {
  return m ? m.date.toISOString().slice(0, 16) : null;
}

test("explicit month/day with time", () => {
  assert.equal(iso(pickDate("Please finish by November 7, 2026 at 11:59 PM.", received, "deadline")), "2026-11-07T23:59");
});

test("year is inferred from the email date, including year rollover", () => {
  assert.equal(iso(pickDate("Complete by Jan 5.", new Date(Date.UTC(2026, 11, 20)), "deadline")), "2027-01-05T00:00");
});

test("relative: within N days and weekday names", () => {
  assert.equal(iso(pickDate("You have 3 days — complete within 3 days.", received, "deadline")), "2026-11-04T00:00");
  assert.equal(iso(pickDate("Please reply by Friday", received, "deadline")), "2026-11-06T00:00");
});

test("past dates (older than a day before the email) are ignored", () => {
  assert.equal(pickDate("We spoke on March 3, 2026.", received, "deadline"), null);
});

test("deadline cue wins over an unrelated earlier date", () => {
  const text = "Posted on November 2. Your link expires on November 9.";
  assert.equal(iso(pickDate(text, received, "deadline")), "2026-11-09T00:00");
});

test("invalid dates are rejected", () => {
  assert.equal(pickDate("by February 31", received, "deadline"), null);
});
