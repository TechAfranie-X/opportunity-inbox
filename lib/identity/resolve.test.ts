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
  assert.equal(brandFor("Harvey")?.source, "curated");
  assert.equal(brandFor("Harvey AI")?.key, "harvey");
  assert.equal(brandFor("Ramp")?.source, "curated");
  assert.equal(brandFor("Google LLC")?.key, "google");
  assert.equal((brandFor("Harvey") as { fit: string }).fit, "bleed");
  const d = brandFor("Datadog");
  assert.equal(d?.source, "simple-icons");
  assert.equal(d?.src, "/brands/si/datadog.svg");
  assert.equal(brandFor("Everpure"), null);
});

test("light brands are flagged for a dark tile; dark brands stay on the neutral tile in their own (near-black) colour", async () => {
  const { isLightBrand } = await import("./resolve.ts");
  assert.equal(isLightBrand("FFFC00"), true);
  assert.equal(isLightBrand("CCFF00"), true);
  assert.equal(isLightBrand("632CA6"), false);
  assert.equal(isLightBrand("000000"), false);
});

test("descriptors are removed from the ends of a name, never invented: News, years, legal and 'Insurance Company'", async () => {
  const { lookupKeys } = await import("./names.ts");
  assert.ok(lookupKeys("CodePath News").includes("codepath"));
  assert.ok(lookupKeys("Ramp 2025").includes("ramp"));
  assert.ok(lookupKeys("Arcesium LLC").includes("arcesium"));
  assert.ok(lookupKeys("Allstate Insurance Company").includes("allstate"));
  assert.ok(lookupKeys("Volunteer at CodePath").includes("codepath"));
  assert.ok(lookupKeys("Stanford University").includes("stanford"));
  assert.ok(lookupKeys("Susquehanna (Do Reply)").includes("susquehanna"));
  assert.equal(brandFor("Ramp 2025")?.key, "ramp");
});
