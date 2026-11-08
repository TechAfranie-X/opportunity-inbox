import assert from "node:assert/strict";
import test from "node:test";
import { runSync } from "../recruiting/sync-engine.ts";
import { sampleMailSource } from "./sample-source.ts";
import { isSampleLoginEnabled, isSampleUser } from "./sample.ts";

test("sample login is dev-only: needs SAMPLE_LOGIN=1 and is never on in production", () => {
  assert.equal(isSampleLoginEnabled({}), false);
  assert.equal(isSampleLoginEnabled({ SAMPLE_LOGIN: "1" }), true);
  assert.equal(isSampleLoginEnabled({ SAMPLE_LOGIN: "1", NODE_ENV: "production" }), false);
  assert.equal(isSampleUser("sample-sam-rivera"), true);
  assert.equal(isSampleUser("118273645"), false);
});

test("the sample source lists newest-first, returns replies without bodies, and is empty of outbound in candidates", async () => {
  const src = sampleMailSource(new Date("2026-11-10T15:00:00Z"));
  const refs = await src.listCandidates(1000);
  assert.ok(refs.length > 50);
  const out = await src.fetchOutbound(refs.map((r) => r.threadId));
  assert.ok(out.length > 0 && out.every((e) => e.outbound && e.bodyText === ""));
  const { emails, missing } = await src.fetchEmails([refs[0].id, "nope"]);
  assert.equal(emails.length, 1);
  assert.deepEqual(missing, ["nope"]);
});
