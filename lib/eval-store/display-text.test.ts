import assert from "node:assert/strict";
import test from "node:test";
import { cleanDisplayLine, cleanDisplayText } from "./display-text.ts";

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const INVISIBLE_ANY = /[­͏​-‏⁠-⁯﻿ﾠㅤ᠎]/;
const ENTITY_ANY = /&(?:#\d+|#x[0-9a-f]+|[a-z]{2,10});/i;

// A marketing email whose preheader is padded with invisible junk, as many senders do.
const preheaderJunk = `Your assessment is ready &#847;&zwnj;&#8199;&#65279; &#847;&zwnj;&#8199;&#65279; &#847;&zwnj;&#8199;&#65279; &#847;&zwnj;&#8199;&#65279;`;

test("numeric and named entities decode, invisible padding disappears, meaning stays", () => {
  const out = cleanDisplayText(preheaderJunk);
  assert.equal(out, "Your assessment is ready");
  assert.ok(!ENTITY_ANY.test(out));
});

test("real invisible characters (not just entities) are stripped too", () => {
  const raw = `Hello${ch(0x200b)} ${ch(0x200c)}${ch(0xfeff)}${ch(0x034f)}there${ch(0x00ad)}, your${ch(0x2007)}interview${ch(0x00a0)}is${ch(0x202f)}confirmed`;
  const out = cleanDisplayText(raw);
  assert.equal(out, "Hello there, your interview is confirmed");
  assert.ok(!INVISIBLE_ANY.test(out));
});

test("an HTML-heavy email becomes readable text and keeps dates, company, role and link targets", () => {
  const html = `<!DOCTYPE html><html><head><title>x</title><style>.a{color:red}</style></head><body>
    <div style="display:none">&#847;&zwnj;&nbsp;&#8199;&#65279;</div>
    <table><tr><td><h1>Brightwater&nbsp;Labs</h1></td></tr>
    <tr><td><p>Hi Sam,</p><p>Thank you for applying to the <b>Software Engineering Intern (Summer 2027)</b> role.</p>
    <p>Your interview is <strong>Wednesday, November&nbsp;4 at 2:00&nbsp;PM</strong>.</p>
    <p><a href="https://careers.brightwater.example/interview/abc?x=1&amp;y=2" style="color:blue">Confirm your slot</a></p>
    <ul><li>Bring ID</li><li>Join 5 minutes early</li></ul></td></tr></table>
    <script>track('open')</script><!-- tracking pixel --></body></html>`;
  const out = cleanDisplayText(html);
  for (const keep of ["Brightwater Labs", "Software Engineering Intern (Summer 2027)", "Wednesday, November 4 at 2:00 PM", "Confirm your slot (https://careers.brightwater.example/interview/abc?x=1&y=2)", "- Bring ID", "- Join 5 minutes early", "Hi Sam,"]) {
    assert.ok(out.includes(keep), `missing: ${keep}\n---\n${out}`);
  }
  assert.ok(!/[<>]/.test(out), out);
  assert.ok(!out.includes("color:red") && !out.includes("track('open')") && !out.includes("tracking pixel"));
  assert.ok(!ENTITY_ANY.test(out) && !INVISIBLE_ANY.test(out));
});

test("a corrupted plain-text part that still carries markup and entities is cleaned the same way", () => {
  const raw = `&lt;p&gt;Please complete your coding assessment by&nbsp;March&nbsp;5, 2026.&lt;/p&gt;<br>Link: <a href="https://app.example.com/t/9">https://app.example.com/t/9</a> &amp;amp; thanks`;
  const out = cleanDisplayText(raw);
  assert.ok(out.includes("Please complete your coding assessment by March 5, 2026."), out);
  assert.ok(out.includes("https://app.example.com/t/9"));
  assert.equal(out.match(/https:\/\/app\.example\.com\/t\/9/g)?.length, 1); // link text equal to the URL is not repeated
  assert.ok(out.includes("& thanks"));
  assert.ok(!/[<>]/.test(out) && !ENTITY_ANY.test(out));
});

test("already-clean plain text is returned unchanged (apart from whitespace tidying), including text that mentions angle brackets", () => {
  const plain = "Hi Sam,\n\nYour offer letter is attached. Reply by 2026-03-10 if 3 < 5 and a & b.\n\nBest,\nThe Acme team";
  assert.equal(cleanDisplayText(plain), plain);
});

test("double-encoded entities settle, but real ampersand text is not eaten", () => {
  assert.equal(cleanDisplayText("R&amp;D intern &amp;#847;role"), "R&D intern role");
  assert.equal(cleanDisplayText("AT&T and Q&A"), "AT&T and Q&A");
  assert.equal(cleanDisplayText("price &unknownentity; stays"), "price &unknownentity; stays");
});

test("invalid numeric entities are left alone rather than corrupting text", () => {
  assert.equal(cleanDisplayText("a &#0; b &#1114112; c &#xD800; d"), "a &#0; b &#1114112; c &#xD800; d");
});

test("whitespace is tidied without deleting content: runs collapse, blank-line stacks shrink", () => {
  assert.equal(cleanDisplayText("a   b\t\tc\n\n\n\n\nd   \n  e"), "a b c\n\nd\ne");
});

test("cleaning is idempotent and deterministic", () => {
  const samples = [preheaderJunk, "<p>Hi&nbsp;there</p><br><a href=\"https://x.example/a\">go</a>", "plain & simple", `x${ch(0x200b)}y`];
  for (const s of samples) {
    const once = cleanDisplayText(s);
    assert.equal(cleanDisplayText(once), once);
    assert.equal(cleanDisplayText(s), once);
  }
});

test("it neither summarizes nor interprets: every word of the readable text survives", () => {
  const raw = `<p>We regret to inform you that we will not be moving forward with your application for the Data Analyst role at Initech.</p>`;
  assert.equal(cleanDisplayText(raw), "We regret to inform you that we will not be moving forward with your application for the Data Analyst role at Initech.");
});

test("subject and sender lines come out on one line", () => {
  assert.equal(cleanDisplayLine(`Your&nbsp;Acme&zwnj; assessment${ch(0x200b)}\n is ready`), "Your Acme assessment is ready");
  assert.equal(cleanDisplayLine("Acme &lt;jobs@acme.com&gt;"), "Acme <jobs@acme.com>");
});

test("script content cannot survive as markup: the output is plain text", () => {
  const out = cleanDisplayText(`<img src=x onerror=alert(1)>Hello <script>alert(2)</script>world`);
  assert.equal(out, "Hello world");
});
