import assert from "node:assert/strict";
import { test } from "node:test";
import { brandFor, normalizeCompany } from "./resolve.ts";

test("known employers resolve to a bundled mark, with normalised and aliased names", () => {
  for (const n of ["Datadog", "DATADOG, Inc.", "NVIDIA Corporation", "Stripe"]) assert.ok(brandFor(n), n);
  assert.equal(brandFor("Amazon Web Services")?.key, "amazon");
  assert.equal(brandFor("Meta Platforms, Inc.")?.key, "meta");
  assert.equal(normalizeCompany("Wells Fargo & Co."), "wells fargo and");
});

test("never guesses: unlisted, empty and look-alike names get no mark", () => {
  for (const n of ["Ramp", "Harvey", "Datadogs", "Acme", "", null, undefined, "constructor", "__proto__"]) assert.equal(brandFor(n as string), null, String(n));
});

test("applicant-tracking and job-board vendors are never the employer", () => {
  for (const n of ["Greenhouse", "Lever", "Workday", "Ashby", "SmartRecruiters", "iCIMS", "HackerRank", "LinkedIn", "Handshake", "Oracle Taleo"]) assert.equal(brandFor(n), null, n);
});
