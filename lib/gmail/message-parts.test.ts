import assert from "node:assert/strict";
import { test } from "node:test";
import { splitMessage } from "./message-parts.ts";

test("a reply separates what was written now from the quoted history", () => {
  const p = splitMessage("Re: Update on Acme", "Hi Sam, great, see you Monday at 10.\n\nBest regards,\nLauren Williams\nUniversity Recruiting at Acme\n\nOn Tue, Mar 3, 2026 at 9:00 AM Lauren <l@acme.com> wrote:\n> Unfortunately we will not be moving forward.\n> Thanks");
  assert.match(p.current, /see you Monday/);
  assert.doesNotMatch(p.current, /moving forward/);
  assert.match(p.quoted, /not be moving forward/);
  assert.match(p.signature, /University Recruiting at Acme/);
  assert.ok(p.meta.isReply && p.meta.hasQuoted && !p.meta.isForward);
});

test("a forwarded employer message is kept as forwarded evidence, apart from the forwarder's note", () => {
  const p = splitMessage("Fwd: Your offer", "FYI, look at this.\n\n---------- Forwarded message ---------\nFrom: HR <hr@acme.com>\nSubject: Your offer\n\nWe are pleased to offer you the position.");
  assert.match(p.current, /FYI/);
  assert.match(p.forwarded, /pleased to offer/);
  assert.ok(p.meta.isForward);
});

test("an Outlook-style header block starts the quoted history; a plain message is all current", () => {
  const p = splitMessage("Re: Program", "Thank you for letting us know.\n\nFrom: Afrane <a@x.com>\nDate: Thursday, April 23, 2026\nTo: Alan\nSubject: Re: Program\n\nI will be unable to participate.");
  assert.doesNotMatch(p.current, /unable to participate/);
  assert.match(p.quoted, /unable to participate/);
  const plain = splitMessage("Application received", "Thank you for applying to Acme. We received your application.\n\nThis email was intended for a@x.com");
  assert.match(plain.current, /received your application/);
  assert.doesNotMatch(plain.current, /intended for/);
  assert.equal(plain.quoted, "");
  assert.ok(!plain.meta.isReply && !plain.meta.hasQuoted);
});
