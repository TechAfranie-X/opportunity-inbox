import assert from "node:assert/strict";
import test from "node:test";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import type { RecruitingEmail } from "../recruiting/types.ts";
import { readMail } from "../reliability/assess.ts";
import { isNearMiss } from "../reliability/flags.ts";
import { applyAssist, interviewKind, isSemanticExcluded } from "./assist.ts";

const mail = (id: string, from: string, subject: string, body: string, labels = ["INBOX"]): RecruitingEmail => ({ id, threadId: `t-${id}`, from, subject, bodyText: body, receivedAt: new Date("2026-05-01T12:00:00Z"), outbound: false, labels });
const op = (recruiting: boolean, type: VerifiedOutput["type"], certainty: VerifiedOutput["certainty"] = "high"): VerifiedOutput => ({ key: "k", status: "ok", recruiting, type, stage: null, company: null, companySource: null, role: null, dateText: null, certainty, evidence: { hash: "h", offset: 0 }, rejections: [] });

const SILENT = mail("s", "Robin <robin.ames@summit-ai.example>", "Reference", "Hello Dana, we would like two references from you for the research role. Reply when you can.");
const JUNK_NEAR = mail("j", "Casey <casey.park@quill-labs.example>", "grab a time", "Grab any slot here for a chat about the Analytics Intern opening at Quill.", ["INBOX", "IMPORTANT"]);

test("assist: a high-certainty yes on mail the rules did not see becomes a pipeline event; medium becomes a counted question; low is ignored", () => {
  const events = readMail([SILENT]);
  assert.equal(events.find((e) => e.gmailMessageId === "s" && !isNearMiss(e)), undefined, "precondition: no rules event");
  const hi = applyAssist(events, [SILENT], new Map([["s", op(true, "follow_up" as never)]]));
  const e = hi.find((x) => x.gmailMessageId === "s")!;
  assert.ok(!isNearMiss(e) && e.signals.includes("semantic:event"));
  const med = applyAssist(events, [SILENT], new Map([["s", op(true, "status_update", "medium")]]));
  assert.ok(isNearMiss(med.find((x) => x.gmailMessageId === "s")!), "medium is a question for a person");
  const low = applyAssist(events, [SILENT], new Map([["s", op(true, "status_update", "low")]]));
  assert.equal(low.find((x) => x.gmailMessageId === "s"), undefined);
});

test("assist: a near miss the model reads as not recruiting is excluded from review, never deleted", () => {
  const events = readMail([JUNK_NEAR]);
  const near = events.find((e) => e.gmailMessageId === "j");
  assert.ok(near && isNearMiss(near), "precondition: structural near miss");
  const out = applyAssist(events, [JUNK_NEAR], new Map([["j", op(false, null)]]));
  const e = out.find((x) => x.gmailMessageId === "j")!;
  assert.ok(isNearMiss(e) && isSemanticExcluded(e), "kept as metadata, flagged excluded");
  const unsure = applyAssist(events, [JUNK_NEAR], new Map([["j", { ...op(false, null), status: "unsupported_yes" as never }]]));
  assert.ok(!isSemanticExcluded(unsure.find((x) => x.gmailMessageId === "j")!), "an unverified opinion has no effect");
});

test("assist: no opinion, no effect", () => {
  const events = readMail([SILENT, JUNK_NEAR]);
  assert.deepEqual(applyAssist(events, [SILENT, JUNK_NEAR], new Map()), events);
});

test("interviewKind: a confirmed time is scheduled, offered choices are an invitation, anything else keeps the model's type", () => {
  const m = (bodyText: string) => ({ subject: "Chat", bodyText, receivedAt: new Date("2026-03-02T12:00:00Z") });
  assert.equal(interviewKind(m("Great, you're booked for Thursday March 5 at 2:00pm. See you then."), "interview_invite"), "interview_scheduled");
  assert.equal(interviewKind(m("Which works better: Tuesday at 10am or Wednesday at 3pm? Let me know."), "interview_scheduled"), "interview_invite");
  assert.equal(interviewKind(m("We would like to talk with you about the role."), "interview_invite"), "interview_invite");
  assert.equal(interviewKind(m("You're booked for Thursday at 2pm."), "offer"), "offer", "other types are never touched");
});

import { notAProcess } from "./assist.ts";
test("a model-found event is vetoed when its subject is a membership invitation, a welcome/account notice or an event promotion and nothing names the reader's own process; real process mail is not", () => {
  const m = (subject: string, bodyText = "Hello.") => ({ subject, bodyText });
  for (const s of ["You Are Invited to Join the Honor Society", "Welcome to DialCare!", "Honors College Invitation to Apply for Membership", "RSVP Now: Ask our interns anything this week", "Welcome to Orbis - Onboarding Username"]) assert.ok(notAProcess(m(s)), s);
  assert.ok(!notAProcess(m("Welcome to Orbis!", "Hi Sam, thank you for applying. We have received your application for the Data Intern role.")), "a welcome that names the reader's application stays");
  for (const s of ["Your application to Orbis", "Interview invitation", "Assessment: complete within 5 days", "Update on your Databricks-like Fellows Application"]) assert.ok(!notAProcess(m(s)), s);
});

test("assist: a model alone never ends a candidacy (a mass-mailed invitation read as a rejection stays a question); real closure wording and real invitations still count", () => {
  const promo = mail("p1", "Insiders Program <hello@lumen-works.example>", "Dana, You're Invited: Lumen Insiders Program!", "Join our community of students for events, newsletters and perks. Unsubscribe at any time. 100 Main Street.");
  const closed = mail("p2", "Lumen Recruiting <no-reply@lumen-works.example>", "Update on your application", "Dear Dana, thank you for your interest. After careful review you are no longer under consideration for the Data Intern role at Lumen. We wish you well.");
  const invite = mail("p3", "Lumen Recruiting <no-reply@lumen-works.example>", "Interview invitation: Data Intern", "Dana, we would like to invite you to interview for the Data Intern role. Please choose a slot.");
  const none = (ms: RecruitingEmail[]) => ms.map((m) => [m.id, op(true, "rejection")] as const);
  const asPromo = applyAssist([], [promo], new Map([["p1", op(true, "rejection")]]));
  assert.ok(asPromo.every((e) => isNearMiss(e)), "promo: the model's rejection is a question, not a pipeline event");
  const asClosed = applyAssist(readMail([closed]), [closed], new Map(none([closed])));
  assert.ok(asClosed.some((e) => e.gmailMessageId === "p2" && e.type === "rejection" && !isNearMiss(e)), "real closure wording stays a rejection");
  const asInvite = applyAssist([], [invite], new Map([["p3", op(true, "interview_invite")]]));
  assert.ok(asInvite.some((e) => e.gmailMessageId === "p3" && e.type === "interview_invite" && !isNearMiss(e)), "a real invitation still counts");
  assert.ok(notAProcess({ subject: promo.subject, bodyText: promo.bodyText }), "the promotion subject is vetoed");
  assert.ok(!notAProcess({ subject: "You're invited to interview for the Data Intern role", bodyText: "We would like to invite you to interview." }), "an interview invitation is not vetoed");
});
