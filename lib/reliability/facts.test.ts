import assert from "node:assert/strict";
import test from "node:test";
import type { RecruitingEmail } from "../recruiting/types.ts";
import { isNearMiss } from "./flags.ts";
import { readMail } from "./assess.ts";

// Synthetic text, fictional employers. Negative cases matter as much as positive ones: a fact must not fire on look-alike wording.
const mail = (id: string, from: string, subject: string, body: string, at: string): RecruitingEmail => ({ id, threadId: id, from, subject, bodyText: body, receivedAt: new Date(at), outbound: false });
const one = (m: RecruitingEmail) => readMail([m])[0];

test("a cancelled interview is not a scheduled interview", () => {
  const e = one(mail("c1", "Recruiting <recruiting@northpeak.example>", "Update on your upcoming interview", "Hi Sam, your upcoming interview on Friday at 2:00 PM has been cancelled. We appreciate your interest in Northpeak.", "2026-03-02T15:00:00Z"));
  assert.ok(e && e.type !== "interview_scheduled" && e.type !== "interview_invite", e?.type);
  assert.equal(e.eventDate, null);
});

test("a reschedule is not a cancellation, and a confirmed interview stays scheduled", () => {
  const re = one(mail("c2", "Recruiting <recruiting@northpeak.example>", "Your interview has been rescheduled", "Hi Sam, your interview on Friday was cancelled and rescheduled: your new time is Monday, March 9 at 3:00 PM ET.", "2026-03-02T15:00:00Z"));
  assert.ok(re && !re.signals.includes("cancellation (fact)"));
  const ok = one(mail("c3", "Priya <priya@northpeak.example>", "Your interview is confirmed", "Hi Sam, your interview is confirmed for Friday, March 6 at 12:00 PM ET. If you need to cancel, reply to this email.", "2026-03-02T15:00:00Z"));
  assert.equal(ok?.type, "interview_scheduled");
});

test("an explicit deadline beats a relative window, and a passed explicit deadline is kept", () => {
  const a = one(mail("d1", "Kestrel via CodeSignal <no-reply@codesignal.com>", "Reminder: Kestrel is waiting for your assessment", "Please complete your assessment within 7 days of your invitation. The deadline is October 8 at 11:59 PM PT.", "2026-10-02T14:00:00Z"));
  assert.equal(a?.eventDate?.toISOString().slice(0, 10), "2026-10-08");
  const b = one(mail("d2", "Prism via CodeSignal <no-reply@codesignal.com>", "Your Prism coding assessment", "Your coding assessment was due on September 28. Contact the recruiting team to request an extension.", "2026-09-30T10:00:00Z"));
  assert.equal(b?.eventDate?.toISOString().slice(0, 10), "2026-09-28");
});

test("a relative-only deadline is left to the reader", () => {
  const e = one(mail("d3", "Hiring <no-reply@us.greenhouse-mail.io>", "Complete your Arbor coding challenge", "Hi Sam, please complete the coding challenge within 5 days.", "2026-10-02T10:00:00Z"));
  assert.equal(e?.eventDate?.toISOString().slice(0, 10), "2026-10-07");
  assert.ok(!e?.signals.includes("explicit deadline (fact)"));
});

test("generic personality results with an upsell are not a candidacy; an employer's assessment with similar words is", () => {
  const generic = readMail([mail("g1", "Insight Profiles <no-reply@insightprofiles.example>", "Your DISC Assessment Results", "Thank you for completing the DISC assessment. Your personality style results are ready. Upgrade to the Pro report for $29 to unlock your full career profile.", "2026-07-20T12:00:00Z")]);
  assert.ok(generic.length === 0 || generic.every((e) => isNearMiss(e)));
  const real = readMail([mail("g2", "Talent <no-reply@us.greenhouse-mail.io>", "Next steps for your Arbor application", "Thanks for applying to the Software Engineer role at Arbor. Please complete the online assessment (a short personality and coding exercise) by October 20 to move to the next round.", "2026-10-10T10:00:00Z")]);
  assert.ok(real.length === 1 && !isNearMiss(real[0]));
});

test("review regressions: a past cancellation inside a live confirmation, and non-deadline dates", () => {
  const live = one(mail("r1", "Priya <priya@northpeak.example>", "Interview confirmed", "Hi Sam, your interview is confirmed. The previous meeting was cancelled, so see you Nov 20 at 2:00 PM.", "2026-11-10T15:00:00Z"));
  assert.equal(live?.type, "interview_scheduled");
  const a = one(mail("r2", "Kestrel via CodeSignal <no-reply@codesignal.com>", "Your Kestrel assessment", "Interviews take place before November 30. Please complete the assessment by December 5.", "2026-11-10T14:00:00Z"));
  assert.equal(a?.eventDate?.toISOString().slice(0, 10), "2026-12-05");
});
