import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The product must never write evaluation evidence: that is the job of the guarded CLI on the frozen checkout.
test("product code does not import the shadow collector", () => {
  for (const file of ["../app/actions.ts", "./recruiting/sync.ts", "./gmail/source.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /shadow\/collect|collectShadow|readShadowConfig/, file);
  }
});
