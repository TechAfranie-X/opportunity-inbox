import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POLICY, decide } from "./policy.ts";
import { EXTRACTOR_VERSION } from "./version.ts";

test("extractor version is set and well-formed", () => {
  assert.match(EXTRACTOR_VERSION, /^\d{4}\.\d{1,2}\.\d+-[\w-]+$/);
});

test("default policy reproduces the pre-policy review threshold", () => {
  assert.equal(DEFAULT_POLICY.reviewBelow, 0.6);
  assert.equal(DEFAULT_POLICY.unknownBelow, 0);
});

test("decide: accepted, review and unknown states", () => {
  assert.deepEqual(decide("Acme", 0.9), { value: "Acme", confidence: 0.9, state: "accepted" });
  assert.equal(decide("Acme", 0.59).state, "review");
  assert.equal(decide("Acme", 0.6).state, "accepted");
  assert.deepEqual(decide(null, 0.9), { value: null, confidence: 0.9, state: "unknown" });
});

test("decide: a stricter unknownBelow withholds the value instead of showing it with a caveat", () => {
  const strict = { reviewBelow: 0.6, unknownBelow: 0.4 };
  assert.deepEqual(decide("Acme", 0.3, strict), { value: null, confidence: 0.3, state: "unknown" });
  assert.equal(decide("Acme", 0.5, strict).state, "review");
});
