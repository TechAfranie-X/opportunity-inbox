import { createHash } from "node:crypto";
import { READER_STAGES, READER_TYPES } from "./types.ts";

/** Labeling guide v2, locked. It is the model's instructions and the labelers' reference. Do not edit after the first scored run. */
export const GUIDE_V2 = `# Classification guide v2 (Opportunity Inbox)
You read ONE email sent to ONE job-seeking student and describe it. Redactions such as [link], [email], [num] and [candidate] are intentional.

## Is it recruiting?
recruiting = "yes" ONLY if the email is genuinely part of THIS person's hiring process or is direct employer outreach to them:
 - application confirmations, recruiter outreach to the person, assessments or coding challenges, interview invitations or scheduling, offers, rejections, "position filled" or "no longer reviewing" notices tied to their application, withdrawals, and status updates about their application;
 - a reminder SPECIFICALLY tied to the recipient's existing or started application (for example "you started your application but have not submitted it", "your application is due tomorrow");
 - candidacy for paid gig, contract or project work (for example an invitation to complete an assessment for a paid project);
 - portal or access-code messages ONLY when the visible message ties them to a specific application or hiring process.
recruiting = "no" for: generic hackathons, webinars, events, bootcamps, newsletters, training, ads, job-alert digests ("new jobs for you"), talent-community marketing; generic "applications are open", "applications close soon", "remember to apply" broadcasts addressed to everyone; receipts, account or security codes with no visible tie to a hiring process; applications for things that are not employment (prizes, conferences, event waitlists, school admissions); employer-run events unless explicitly part of the hiring process; mail that is not about this person's own process (for example someone else's forwarded message).
Classify by the actual content, not by subject wording: an "Application Update" subject that really announces a generic event is "no".

## Type (only if recruiting is "yes"): exactly one of
applied | recruiter_outreach | assessment | interview_invite | interview_scheduled | status_update | offer | rejection | withdrawn
 - applied: application received or confirmed, with nothing further asked of the candidate.
 - recruiter_outreach: an employer or recruiter contacts a person who has not applied.
 - assessment: the candidate is asked to complete, or is reminded to complete, an assessment, test or challenge. If one email both confirms an application AND asks for an assessment, the type is "assessment" and the stage is "assessment".
 - interview_invite: asked to schedule, choose a time for, or complete an interview. interview_scheduled: a confirmed interview time.
 - offer: an offer of employment or a position.
 - rejection: a clear no, including "position filled", "no longer reviewing", "unable to move forward", "unable to consider your application".
 - withdrawn: the candidate withdrew or the employer acknowledges the withdrawal.
 - status_update: everything else about the application, including reminders to finish or submit an existing application and notices that something was received or is under review.
Stage: one of ${READER_STAGES.join(" | ")}. Use "closed" for rejection, withdrawn and position filled.

## Company
The hiring organization the opportunity is with. Prefer the fuller explicit organization or brand name the message supports. Do NOT infer a parent or legal entity from outside knowledge. Vendor and platform names (applicant-tracking systems, assessment platforms, job boards, schedulers) are not employers.
You are given a list of candidates. Set company_candidate to the id of the right candidate (for example "c2"). If none is right but the email itself clearly names the hiring organization, set company_quote to that name copied EXACTLY from the email. Otherwise leave both null.

## Role
The actual employment position stated in the email, copied EXACTLY (for example a job title). A program, fellowship, cohort or event name is NOT a role: if no actual position is stated, role_quote is null.

## Rules
Never invent values. Every quote must be copied exactly from the email. certainty is "high", "medium" or "low" (low = you are guessing).
`;

export const OUTPUT_SPEC = `One JSON object per input line, on one line, with exactly these keys:
{"key": <input key>, "recruiting": "yes"|"no", "type": <one of ${READER_TYPES.join(", ")} or null>, "stage": <one of ${READER_STAGES.join(", ")} or null>, "company_candidate": <candidate id or null>, "company_quote": <exact text or null>, "role_quote": <exact text or null>, "date_quote": <exact text of the most relevant deadline or scheduled time, or null>, "evidence_quote": <exact quote, at most 120 characters, that justifies recruiting yes/no>, "certainty": "high"|"medium"|"low"}
For recruiting "no", type, stage, company_candidate, company_quote, role_quote and date_quote are null.`;

export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const GUIDE_HASH = sha(GUIDE_V2 + OUTPUT_SPEC).slice(0, 12);
export const READER_SCHEMA_VERSION = 1;
/** Identifies exactly what produces a model prediction; part of every cache key. */
export const READER_VERSION = `reader-s${READER_SCHEMA_VERSION}-g${GUIDE_HASH}`;
