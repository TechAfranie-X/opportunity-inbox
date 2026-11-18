import assert from "node:assert/strict";
import test from "node:test";
import { extractBodyText } from "../../../lib/gmail/body.ts";
import { isNearMiss } from "../../../lib/reliability/flags.ts";
import { readMail } from "../../../lib/reliability/assess.ts";
import type { ExtractedEvent, RecruitingEmail } from "../../../lib/recruiting/types.ts";

/**
 * INGESTION-layer development cases: synthetic message TEXT written for this benchmark (fictional employers, wording modelled on the audited behaviours;
 * no real mail). They run the product's real reader (`readMail`: rules plus the reliability layer) and body decoder. Expectations are the truth the
 * audit established; a failing test is a defect.
 */
const mail = (id: string, from: string, subject: string, body: string, at: string, thread = id): RecruitingEmail => ({ id, threadId: thread, from, subject, bodyText: body, receivedAt: new Date(at), outbound: false });
const read = (...mails: RecruitingEmail[]): ExtractedEvent[] => readMail(mails);
const day = (e: ExtractedEvent | undefined) => e?.eventDate?.toISOString().slice(0, 10) ?? null;

test("[terminal] I01: a message cancelling an upcoming interview is not read as a scheduled interview (audit #10)", () => {
  const [e] = read(mail("i01", "Campus Recruiting <recruiting@brightwatercap.example>", "Update on your upcoming interview", "Hi Sam, we are writing to let you know that your upcoming interview has been cancelled because the role progressed with other candidates. We appreciate your interest in Brightwater Capital.", "2025-11-28T15:00:00Z"));
  assert.ok(e, "an event should exist (it is recruiting mail)");
  assert.ok(!["interview_scheduled", "interview_invite"].includes(e.type), `read as ${e.type} (type confidence ${e.fieldConfidence?.type})`);
});

test("[deadline] I02: an explicit absolute deadline wins over a relative window in the same message (audit #18)", () => {
  const [e] = read(mail("i02", "Kestrel Ventures via CodeSignal <no-reply@codesignal.com>", "Reminder: Kestrel Ventures is waiting for your assessment", "Please complete your assessment within 7 days of your invitation. The deadline is October 8 at 11:59 PM PT.", "2026-10-08T14:00:00Z"));
  assert.equal(day(e), "2026-10-08", `deadline read as ${day(e)}`);
});

test("[deadline] I03: an explicit deadline that has already passed is still recorded (audit #4)", () => {
  const [e] = read(mail("i03", "Prism Analytics via CodeSignal <no-reply@codesignal.com>", "Your Prism Analytics coding assessment", "Your coding assessment was due on September 28. If you still want to take it, contact the recruiting team to request an extension.", "2026-09-30T10:00:00Z"));
  assert.equal(day(e), "2026-09-28", `deadline read as ${day(e)}`);
});

test("[deadline] I04: a relative-only deadline is anchored to the day the message was received", () => {
  const [e] = read(mail("i04", "Hiring <no-reply@us.greenhouse-mail.io>", "Complete your Arbor Systems coding challenge", "Hi Sam, please complete the coding challenge within 5 days.", "2026-10-02T10:00:00Z"));
  assert.equal(day(e), "2026-10-07");
});

test("[terminal] I05: an expired request is recognised as an expiry (audit #4, #18)", () => {
  const [e] = read(mail("i05", "CodeSignal <no-reply@codesignal.com>", "Request from Prism Analytics has expired.", "The request from Prism Analytics to take the Prism Analytics Coding Assessment has expired.", "2026-09-28T09:00:00Z"));
  assert.ok(e?.signals.includes("request expired"), `signals: ${e?.signals.join(", ")}`);
});

test("[false-positive] I06: generic personality-assessment results with a paid upsell do not enter the pipeline as an event (audit #13)", () => {
  const events = read(mail("i06", "Insight Profiles <no-reply@insightprofiles.example>", "Your DISC Assessment Results", "Thank you for completing the DISC assessment. Your personality style results are ready to view. Upgrade to the Pro report for $29 to unlock your full career profile and team insights.", "2026-07-20T12:00:00Z"));
  assert.ok(events.length === 0 || events.every((e) => isNearMiss(e)), `read as ${events.map((e) => `${e.type} (${e.company})`).join(", ")}`);
});

test("[presentation] I07: UTF-8 text mislabeled as iso-8859-1 does not produce mojibake (audit #16)", () => {
  const data = Buffer.from("Software Engineer Intern - Summer 2027 ", "utf8").toString("base64url");
  const text = extractBodyText({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=iso-8859-1" }], body: { data } });
  assert.ok(!/Â/.test(text), JSON.stringify(text));
});

test("[presentation] I08: a genuine windows-1252 message still decodes (the fix must not regress real single-byte mail)", () => {
  const data = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x92, 0x73]).toString("base64url");
  const text = extractBodyText({ mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="windows-1252"' }], body: { data } });
  assert.equal(text, "Café ’s");
});

test("[regression] I09: an explicit confirmed interview with a date and time is scheduled for that time (audit #1)", () => {
  const [e] = read(mail("i09", "Priya Nair <priya.nair@ardentlegal.example>", "Your interview is confirmed", "Hi Sam, your interview is confirmed for Friday, November 20 at 12:00 PM ET. Please join with the link below.", "2026-11-16T15:00:00Z"));
  assert.equal(e?.type, "interview_scheduled");
  assert.equal(day(e), "2026-11-20");
});

test("[regression] I10: an application receipt and an explicit rejection keep their types (audit #5, #6, #14)", () => {
  const [a] = read(mail("i10a", "Careers <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Larkspur Software", "Thank you for applying to the Software Engineering Intern position at Larkspur Software. We received your application.", "2026-09-09T10:00:00Z"));
  const [r] = read(mail("i10b", "Larkspur Recruiting <recruiting@larkspursoft.example>", "Your application to Larkspur Software", "After careful consideration we have decided not to move forward with your application for the Software Engineering Intern role.", "2026-11-09T10:00:00Z"));
  assert.equal(a?.type, "applied");
  assert.equal(r?.type, "rejection");
});

test("[idempotency] I11: reading the same mailbox twice yields identical events with one id per message (audit #16)", () => {
  const box = [
    mail("i11a", "Careers <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Ripple Systems", "Thank you for applying to the Full Stack Software Engineer Intern position at Ripple Systems. We received your application.", "2026-09-25T10:00:00Z", "i11-T"),
    mail("i11b", "Careers <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Ripple Systems", "Thank you for applying to the Backend Software Engineer Intern position at Ripple Systems. We received your application.", "2026-09-25T10:00:20Z", "i11-T"),
  ];
  const first = readMail(box), second = readMail(box);
  assert.deepEqual(first.map((e) => e.gmailMessageId), ["i11a", "i11b"]);
  assert.deepEqual(JSON.stringify(first), JSON.stringify(second));
});

test("[regression] I12: two receipts for two roles keep their own roles at ingestion (the grouping layer must not merge them)", () => {
  const events = readMail([
    mail("i12a", "Careers <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Wayfarer Autonomy", "Thank you for applying to the 2027 Summer Intern, Pipeline Engineer position at Wayfarer Autonomy. We received your application.", "2026-09-09T14:00:00Z", "i12-T"),
    mail("i12b", "Careers <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Wayfarer Autonomy", "Thank you for applying to the 2027 Summer Intern, Systems Software Engineer position at Wayfarer Autonomy. We received your application.", "2026-09-09T14:00:30Z", "i12-T"),
  ]);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].role, events[1].role);
});

test("[actions] I13: an 'Action Needed' offer message is recognised as an offer with a task", { todo: "structured action facts arrive with the facts layer (milestone 4)" }, () => {
  assert.fail("no facts API yet");
});
