import assert from "node:assert/strict";
import test from "node:test";
import { extractBodyText } from "./body.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64url");

test("prefers text/plain and walks nested multipart", () => {
  const text = extractBodyText({
    mimeType: "multipart/mixed",
    parts: [{ mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: b64("Plain body") } },
      { mimeType: "text/html", body: { data: b64("<p>HTML body</p>") } },
    ] }],
  });
  assert.equal(text, "Plain body");
});

test("falls back to stripped html", () => {
  const text = extractBodyText({
    mimeType: "text/html",
    body: { data: b64("<style>p{}</style><p>Complete by <b>Nov 7</b></p><p>Thanks&nbsp;&amp; good luck</p>") },
  });
  assert.match(text, /Complete by Nov 7/);
  assert.match(text, /Thanks & good luck/);
  assert.doesNotMatch(text, /<|p\{\}/);
});

test("handles missing payload", () => {
  assert.equal(extractBodyText(undefined), "");
});
