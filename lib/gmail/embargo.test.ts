import assert from "node:assert/strict";
import test from "node:test";
import { FROZEN } from "../recruiting/shadow/frozen.ts";
import { EMBARGO_CUTOFF, applyEmbargo, embargoActive, embargoBefore, embargoHidingMail } from "./embargo.ts";

test("the embargo cutoff IS the frozen evaluation cutoff (one canonical value)", () => {
  assert.equal(EMBARGO_CUTOFF.toISOString(), FROZEN.cutoff);
});

test("the embargo is on unless explicitly switched off", () => {
  assert.equal(embargoActive({}), true);
  assert.equal(embargoActive({ EVAL_EMBARGO: "on" }), true);
  assert.equal(embargoActive({ EVAL_EMBARGO: "OFF" }), true, "only the exact word off lifts it");
  assert.equal(embargoActive({ EVAL_EMBARGO: "off" }), false);
});

test("the Gmail search is restricted to before the cutoff, in epoch seconds, and untouched when lifted", () => {
  assert.equal(applyEmbargo("newer_than:365d", {}), `newer_than:365d before:${Math.floor(new Date(FROZEN.cutoff).getTime() / 1000)}`);
  assert.equal(applyEmbargo("newer_than:365d", { EVAL_EMBARGO: "off" }), "newer_than:365d");
  assert.equal(embargoBefore({ EVAL_EMBARGO: "off" }), null);
});

test("the user is told about the embargo only once it actually hides mail", () => {
  assert.equal(embargoHidingMail(new Date(new Date(FROZEN.cutoff).getTime() - 1), {}), false);
  assert.equal(embargoHidingMail(new Date(FROZEN.cutoff), {}), true);
  assert.equal(embargoHidingMail(new Date(FROZEN.cutoff), { EVAL_EMBARGO: "off" }), false);
});
