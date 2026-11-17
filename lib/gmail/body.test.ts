import assert from "node:assert/strict";
import test from "node:test";
import { bodyIsUnreadable, extractBodyText, htmlToText } from "./body.ts";

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

const latin1 = (s: string) => Buffer.from(s, "latin1").toString("base64url");
const win1252 = (bytes: number[]) => Buffer.from(bytes).toString("base64url");

test("decodes a declared non-UTF-8 charset instead of corrupting apostrophes and accents", () => {
  // 0x92 is a curly apostrophe in windows-1252 and an invalid byte in UTF-8
  const text = extractBodyText({
    mimeType: "text/plain",
    headers: [{ name: "Content-Type", value: 'text/plain; charset="windows-1252"' }],
    body: { data: win1252([...Buffer.from("We have decided to move forward with other candidates; you"), 0x92, ...Buffer.from("re not selected. Caf"), 0xe9]) },
  });
  assert.match(text, /you\u2019re not selected\. Caf\u00e9/);
  assert.doesNotMatch(text, /\ufffd/);
  assert.equal(extractBodyText({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=iso-8859-1" }], body: { data: latin1("Caf\u00e9") } }), "Caf\u00e9");
});

test("an unknown or missing charset falls back to UTF-8 and never throws", () => {
  const data = Buffer.from("Hello \u2019 world").toString("base64url");
  assert.equal(extractBodyText({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=x-nonsense" }], body: { data } }), "Hello \u2019 world");
  assert.equal(extractBodyText({ mimeType: "text/plain", body: { data } }), "Hello \u2019 world");
});

test("html entities: numeric, hex and the common named ones decode; unknown ones are left alone", () => {
  assert.equal(htmlToText("<p>you&#8217;re in &mdash; see&nbsp;you&#x2019;s &amp; &hellip; &bogus; &#99999999;</p>"), "you\u2019re in \u2014 see you\u2019s & \u2026 &bogus; &#99999999;");
});

test("a short plain-text stub beside the real HTML message is not mistaken for the message", () => {
  const html = "<p>Hi Sam, we would like to invite you to interview for the Backend Engineer Intern role. Please select a time that works for you using the link below, and let us know if you have any questions at all about the process.</p>";
  const text = extractBodyText({ mimeType: "multipart/alternative", parts: [
    { mimeType: "text/plain", body: { data: b64("Please view this email in an HTML-capable client.") } },
    { mimeType: "text/html", body: { data: b64(html) } },
  ] });
  assert.match(text, /invite you to interview/);
  // but a genuine short plain message wins over a long html wrapper only when it is not a stub: equal-ish lengths keep plain
  const both = extractBodyText({ mimeType: "multipart/alternative", parts: [
    { mimeType: "text/plain", body: { data: b64("Thanks! Interview confirmed for Tuesday at 2pm.") } },
    { mimeType: "text/html", body: { data: b64("<p>Thanks! Interview confirmed for Tuesday at 2pm.</p>") } },
  ] });
  assert.equal(both, "Thanks! Interview confirmed for Tuesday at 2pm.");
});

test("an empty message whose text sits behind an attachment id is reported as unreadable, not as empty", () => {
  const payload = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { attachmentId: "ANGjd", size: 90_000 } }] };
  assert.equal(bodyIsUnreadable(payload, extractBodyText(payload)), true);
  assert.equal(bodyIsUnreadable({ mimeType: "text/plain", body: { data: b64("hello") } }, "hello"), false);
  assert.equal(bodyIsUnreadable(undefined, ""), false);
});
