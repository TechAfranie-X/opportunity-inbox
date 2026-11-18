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
  for (const n of ["Datadogs", "Acme", "Everpure", "", null, undefined, "constructor", "__proto__"]) assert.equal(brandFor(n as string), null, String(n));
});

test("applicant-tracking and job-board vendors are never the employer", () => {
  for (const n of ["Greenhouse", "Lever", "Workday", "Ashby", "SmartRecruiters", "iCIMS", "HackerRank", "LinkedIn", "Handshake", "Oracle Taleo"]) assert.equal(brandFor(n), null, n);
});

test("curated full-colour assets take priority, resolve through aliases, and carry their fit", () => {
  assert.equal(brandFor("Harvey")?.kind, "image");
  assert.equal(brandFor("Harvey AI")?.key, "harvey");
  assert.equal(brandFor("Ramp")?.kind, "image");
  assert.equal(brandFor("Google LLC")?.key, "google");
  assert.equal((brandFor("Harvey") as { fit: string }).fit, "bleed");
  const d = brandFor("Datadog");
  assert.equal(d?.kind, "glyph");
  assert.equal((d as { color: string }).color, "632CA6");
  assert.equal(brandFor("Everpure"), null);
});

test("light brands are flagged for a dark tile; dark brands stay on the neutral tile in their own (near-black) colour", async () => {
  const { isLightBrand } = await import("./resolve.ts");
  assert.equal(isLightBrand("FFFC00"), true);
  assert.equal(isLightBrand("CCFF00"), true);
  assert.equal(isLightBrand("632CA6"), false);
  assert.equal(isLightBrand("000000"), false);
});
