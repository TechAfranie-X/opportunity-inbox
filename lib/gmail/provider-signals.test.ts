import assert from "node:assert/strict";
import { test } from "node:test";
import { providerSignalsFromGmailLabels } from "./provider-signals.ts";

test("maps Gmail category labels to provider-neutral priors", () => {
  const signals = providerSignalsFromGmailLabels([
    "INBOX",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "CATEGORY_UPDATES",
    "CATEGORY_PERSONAL",
    "IMPORTANT",
    "STARRED",
  ]);

  assert.deepEqual(signals, {
    promotional: true,
    social: true,
    updates: true,
    personal: true,
    important: true,
    starred: true,
  });
});

test("missing Gmail labels produce empty provider priors", () => {
  assert.deepEqual(providerSignalsFromGmailLabels(undefined), {
    promotional: false,
    social: false,
    updates: false,
    personal: false,
    important: false,
    starred: false,
  });
});
