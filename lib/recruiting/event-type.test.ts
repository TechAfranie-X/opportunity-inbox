import assert from "node:assert/strict";
import test from "node:test";
import { extractAll, extractEvent, stripQuoted } from "./extract.ts";
import type { RecruitingEmail } from "./types.ts";

const at = new Date(Date.UTC(2026, 10, 1, 10));
function email(over: Partial<RecruitingEmail> & { subject: string; bodyText: string }): RecruitingEmail {
  return { id: "m1", threadId: "t1", from: "Acme Recruiting <jobs@acme.com>", receivedAt: at, outbound: false, ...over };
}

test("conditional rejection boilerplate is NOT a rejection", () => {
  const e = extractEvent(email({
    subject: "Thank you for your application!",
    bodyText: "We received your application. If you are not selected for this position, keep an eye on our jobs page.",
  }));
  assert.equal(e?.type, "applied");
});

test("'candidates who are not selected' and 'that means ... you were not selected' stay conditional", () => {
  for (const body of [
    "Candidates who are not selected for this event are encouraged to apply again.",
    "If your status is inactive, that means the position is closed or you were not selected for the role.",
  ]) {
    const e = extractEvent(email({ subject: "Update on your application", bodyText: body }));
    assert.notEqual(e?.type, "rejection", body);
  }
});

test("unconditional rejection language wins over a generic subject", () => {
  const e = extractEvent(email({
    subject: "Application update",
    bodyText: "After careful consideration, we have decided to pursue other candidates at this time.",
  }));
  assert.equal(e?.type, "rejection");
});

test("generic update with no supporting content resolves to status_update, not a terminal state", () => {
  const e = extractEvent(email({ subject: "An update on your application", bodyText: "Please log in to the portal to see your status." }));
  assert.equal(e?.type, "status_update");
});

test("'next steps' boilerplate in a confirmation email does not make it an interview invite", () => {
  const e = extractEvent(email({
    subject: "Thank you for applying to Acme",
    bodyText: "We received your application. Next steps: our team will review it and be in touch.",
  }));
  assert.equal(e?.type, "applied");
});

test("an explicit scheduling ask is an interview invite", () => {
  const e = extractEvent(email({
    subject: "Next steps with Acme",
    bodyText: "We'd like to move to the next steps in our hiring process. Please select a time that works for you using the link below.",
  }));
  assert.equal(e?.type, "interview_invite");
});

test("quoted history in a reply does not create an offer", () => {
  const body = "Thanks, I'll confirm by Friday.\n\nOn Mon, Oct 5, 2026 at 9:00 AM Acme <jobs@acme.com> wrote:\n> We are pleased to extend you an offer for the role.";
  assert.equal(stripQuoted(body).includes("pleased"), false);
  const e = extractEvent(email({ subject: "Re: Your Acme interview", bodyText: body }));
  assert.notEqual(e?.type, "offer");
});

test("real offer language is an offer", () => {
  const e = extractEvent(email({ subject: "Your Acme Offer is Ready", bodyText: "We are pleased to extend you an offer for the Software Engineer Intern role." }));
  assert.equal(e?.type, "offer");
});

test("assessment reminder is an assessment, not a completed one", () => {
  const e = extractEvent(email({
    subject: "Reminder: Acme is waiting for your Coding Assessment result",
    bodyText: "Your link expires soon.",
  }));
  assert.equal(e?.type, "assessment");
});

test("keyword-free reply inside a known recruiting thread is kept as a neutral update; auto-replies are not", () => {
  const first = email({ id: "a", subject: "Thank you for applying to Acme", bodyText: "We received your application." });
  const reply = email({ id: "b", subject: "Re: Thank you for applying to Acme", bodyText: "Sounds good, talk soon.", from: "Pat <pat@acme.com>" });
  const auto = email({ id: "c", subject: "Automatic reply: Thank you for applying to Acme", bodyText: "I am away." });
  const events = extractAll([first, reply, auto]);
  assert.deepEqual(events.map((e) => e.gmailMessageId).sort(), ["a", "b"]);
  assert.equal(events.find((e) => e.gmailMessageId === "b")!.type, "status_update");
});
