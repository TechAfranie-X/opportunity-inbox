import type { ActionKind, Stage } from "../../../lib/recruiting/types.ts";
import type { EvSpec } from "../harness.ts";

/**
 * DEVELOPMENT cases for lifecycle integrity: the shapes of the 21-opportunity audit (2026-11-18), as stored-event fixtures. They contain NO message text and
 * NO real employer: employer names are pseudonyms, ids are synthetic; what is preserved is the structure that produced each failure (types, roles, dates, thread
 * relationships, signals, confidences, the "now" of the check). The expectations are what the Gmail-grounded audit says is TRUE, not what the code does:
 * a failing facet is a defect to fix, never a test to relax. `note` records where a case is indeterminate.
 */
export type Facet =
  | { cat: Cat; kind: "mustLink"; a: string; b: string; why: string }
  | { cat: Cat; kind: "cannotLink"; a: string; b: string; why: string }
  | { cat: Cat; kind: "role"; of: string; includes?: string; excludes?: string; why: string }
  | { cat: Cat; kind: "stage"; of: string; is: Stage; why: string }
  | { cat: Cat; kind: "active"; of: string; is: boolean; why: string }
  | { cat: Cat; kind: "outcome"; of: string; is: string | null; why: string }
  | { cat: Cat; kind: "action"; of: string; actionKind: ActionKind; present: boolean; why: string }
  | { cat: Cat; kind: "noNeedsYou"; of: string; why: string }
  | { cat: Cat; kind: "contradictionFlagged"; of: string; why: string }
  | { cat: Cat; kind: "uniqueEvents"; why: string }
  | { cat: Cat; kind: "keepsCorrection"; of: string; why: string };
export type Cat = "grouping" | "terminal" | "role" | "actions" | "review" | "idempotency" | "false-positive" | "regression" | "dormancy";

export type LifecycleCase = {
  id: string;
  /** Audit finding ids this case reproduces. */
  findings: string[];
  title: string;
  company: string;
  /** The day the product is looked at (audit date unless the case says otherwise). */
  now: string;
  events: EvSpec[];
  facets: Facet[];
  note?: string;
  indeterminate?: boolean;
  /** Full ground-truth partition of the case's events (held-out scenarios, where truth is fixed by construction). */
  truth?: string[][];
};

const NOW = "2026-11-18";

export const LIFECYCLE_CASES: LifecycleCase[] = [
  {
    id: "G01-reapply-next-cycle", findings: ["F-01"], title: "Same employer and role family re-applied for the next season (audit #1)", company: "Ardent Legal", now: NOW,
    events: [
      { id: "g01-a1", at: "2026-02-01", type: "applied", role: "Software Engineering Intern (Summer 2026)" },
      { id: "g01-a2", at: "2026-02-10", type: "assessment", role: "Software Engineering Intern (Summer 2026)", date: "2026-02-13" },
      { id: "g01-a3", at: "2026-02-20", type: "interview_invite", role: "Software Engineering Intern (Summer 2026)" },
      { id: "g01-a4", at: "2026-03-12", type: "interview_scheduled", role: "Software Engineering Intern (Summer 2026)", date: "2026-03-13T15:00:00Z" },
      { id: "g01-b1", at: "2026-10-05", type: "applied", role: "Software Engineering Intern (Summer 2027)" },
      { id: "g01-b2", at: "2026-10-14", type: "assessment", role: "Software Engineering Intern (Summer 2027)", date: "2026-10-21" },
      { id: "g01-b3", at: "2026-11-11", type: "interview_invite", role: "Software Engineer, Intern (Winter 2027/Summer 2027)" },
      { id: "g01-b4", at: "2026-11-16", type: "interview_scheduled", role: "Software Engineer, Intern (Winter 2027/Summer 2027)", date: "2026-11-20T17:00:00Z" },
    ],
    facets: [
      { cat: "grouping", kind: "cannotLink", a: "g01-a1", b: "g01-b1", why: "an application eight months later for the next season is a new opportunity" },
      { cat: "grouping", kind: "cannotLink", a: "g01-a4", b: "g01-b4", why: "the Nov 20 interview does not belong to the Summer 2026 cycle" },
      { cat: "grouping", kind: "mustLink", a: "g01-b1", b: "g01-b4", why: "the 2027 application, assessment and interview are one lifecycle" },
      { cat: "role", kind: "role", of: "g01-b4", includes: "2027", excludes: "2026", why: "the current opportunity's title must come from the latest applicable source" },
      { cat: "regression", kind: "stage", of: "g01-b4", is: "interview", why: "the current stage is interview" },
    ],
  },
  {
    id: "G02-season-merge-offer-actions", findings: ["F-02", "F-09"], title: "Two seasons merged; offer and onboarding actions missing (audit #2)", company: "Cumulus CRM", now: "2026-08-28",
    note: "Checked two days after the 'Action Needed: Next Steps for Your Offer' message, so the documented action is fresh.",
    events: [
      { id: "g02-a1", at: "2026-01-30", type: "applied", role: "Summer 2026 Intern - Solution Engineer" },
      { id: "g02-a2", at: "2026-02-06", type: "applied", role: "Summer 2026 Intern - Software Engineer" },
      { id: "g02-a3", at: "2026-04-26", type: "rejection", role: "Solution Engineer" },
      { id: "g02-b1", at: "2026-05-08", type: "applied", role: "Summer 2027 Intern - Software Engineer" },
      { id: "g02-b2", at: "2026-05-28", type: "assessment", role: "Summer 2027 Intern - Software Engineer", date: "2026-06-02" },
      { id: "g02-b3", at: "2026-06-16", type: "interview_invite", role: "Summer 2027 Intern", thread: "g02-T" },
      { id: "g02-b4", at: "2026-06-17", type: "user_reply", thread: "g02-T" },
      { id: "g02-b5", at: "2026-06-19", type: "interview_scheduled", role: "Summer 2027 Intern - Software Engineer virtual", date: "2026-07-01T16:00:00Z" },
      { id: "g02-b6", at: "2026-07-06", type: "offer", role: "Summer 2027 Intern", thread: "g02-T", date: "2026-07-22" },
      { id: "g02-b7", at: "2026-07-29", type: "offer", role: "Summer 2027 Intern", date: "2026-08-05", signals: ["subject"] },
      { id: "g02-b8", at: "2026-07-31", type: "offer", role: "Summer 2027 Intern", date: "2026-08-07", signals: ["subject"] },
      { id: "g02-b9", at: "2026-08-05", type: "user_reply", thread: "g02-T" },
      { id: "g02-b10", at: "2026-08-26", type: "offer", role: "Summer 2027 Intern", thread: "g02-T", signals: ["offer", "subject", "role-inherited"] },
      { id: "g02-b11", at: "2026-08-26", type: "user_reply", thread: "g02-T" },
      { id: "g02-b12", at: "2026-08-27", type: "status_update", role: "Summer 2027 Intern", thread: "g02-T", signals: ["reply-in-recruiting-thread"] },
    ],
    facets: [
      { cat: "grouping", kind: "cannotLink", a: "g02-a2", b: "g02-b1", why: "Summer 2026 and Summer 2027 applications for the same role are separate cycles" },
      { cat: "grouping", kind: "mustLink", a: "g02-b1", b: "g02-b10", why: "the 2027 offer belongs to the 2027 application" },
      { cat: "role", kind: "role", of: "g02-b10", includes: "2027", excludes: "2026", why: "the offer is for Summer 2027, so is the title" },
      { cat: "actions", kind: "action", of: "g02-b10", actionKind: "offer_decision", present: true, why: "an explicit 'Action Needed' offer message two days old must surface on Today" },
    ],
  },
  {
    id: "G03-two-roles-one-thread", findings: ["F-05", "F-10"], title: "2026 role, then two 2027 applications arriving in one Gmail thread (audit #9)", company: "Wayfarer Autonomy", now: NOW,
    events: [
      { id: "g03-a1", at: "2026-03-23", type: "applied", role: "2026 Summer Intern, BS/MS, Software Engineer, Orion" },
      { id: "g03-a2", at: "2026-04-28", type: "applied", role: "and giving us the", fc: { role: 0.3 } },
      { id: "g03-b1", at: "2026-09-09T14:00:00Z", type: "applied", role: "2027 Summer Intern, BS/MS, Pipeline", thread: "g03-T" },
      { id: "g03-b2", at: "2026-09-09T14:00:30Z", type: "applied", role: "2027 Summer Intern, BS, SysEng Software Engineer", thread: "g03-T" },
    ],
    facets: [
      { cat: "grouping", kind: "cannotLink", a: "g03-a1", b: "g03-b1", why: "the 2026 and 2027 applications are different roles and cycles" },
      { cat: "grouping", kind: "cannotLink", a: "g03-b1", b: "g03-b2", why: "two different specific roles are two applications even when Gmail threaded the receipts together" },
      { cat: "role", kind: "role", of: "g03-a1", excludes: "and giving", why: "a fragment of prose is not a role" },
    ],
    note: "The Gmail thread is evidence, not a command to merge: both receipts have the same subject, so Gmail put them in one thread.",
  },
  {
    id: "G04-cancelled-interview", findings: ["F-06", "F-11"], title: "Cancelled interview read as scheduled; a later interest form merged into it (audit #10)", company: "Brightwater Capital", now: NOW,
    note: "The stored event is what the product persisted for the cancellation message: type interview_scheduled at 0.4 type confidence with a 'wording without a specific time' reason.",
    events: [
      { id: "g04-a1", at: "2025-11-28", type: "interview_scheduled", role: "Software Engineering Internship", fc: { type: 0.4, role: 0.6, company: 0.89 }, reviewReasons: ["type: interview wording without a specific time"] },
      { id: "g04-b1", at: "2026-08-02", type: "applied", role: "Software Engineering Interest Form - 2026 Community Summit", fc: { type: 0.65, role: 0.6, company: 0.82 } },
    ],
    facets: [
      { cat: "grouping", kind: "cannotLink", a: "g04-a1", b: "g04-b1", why: "a 2025 interview thread and a 2026 community interest form are different programs" },
      { cat: "terminal", kind: "active", of: "g04-a1", is: false, why: "an interview the employer cancelled must not leave an active Interview opportunity" },
    ],
  },
  {
    id: "G05-externship-vs-internship", findings: ["F-07"], title: "A 2026 externship and a later 2027 internship conversation collapsed (audit #11)", company: "Cobalt Grid", now: NOW,
    events: [
      { id: "g05-a1", at: "2026-01-05", type: "applied", role: "2026 R&D Discovery Externship" },
      { id: "g05-a2", at: "2026-02-23", type: "recruiter_outreach", role: "Externship" },
      { id: "g05-a3", at: "2026-03-16", type: "interview_invite", role: "Externship" },
      { id: "g05-a4", at: "2026-03-20", type: "interview_scheduled", role: "Externship Program", date: "2026-03-25T15:00:00Z" },
      { id: "g05-a5", at: "2026-07-14", type: "assessment", role: "Externship", date: "2026-07-17" },
      { id: "g05-a6", at: "2026-07-28", type: "assessment", role: "Externship", date: "2026-07-31" },
      { id: "g05-b1", at: "2026-08-26", type: "interview_invite", role: "Internship", thread: "g05-T" },
      { id: "g05-b2", at: "2026-09-03", type: "user_reply", thread: "g05-T" },
      { id: "g05-b3", at: "2026-09-04", type: "status_update", role: "Internship", thread: "g05-T" },
      { id: "g05-b4", at: "2026-09-17", type: "user_reply", thread: "g05-T" },
    ],
    facets: [
      { cat: "grouping", kind: "cannotLink", a: "g05-a1", b: "g05-b1", why: "the externship and the later internship conversation are different programs" },
      { cat: "grouping", kind: "cannotLink", a: "g05-a5", b: "g05-b1", why: "an externship assessment and a 2027 internship invite are different lifecycles" },
      { cat: "grouping", kind: "mustLink", a: "g05-b1", b: "g05-b3", why: "one conversation thread about the internship" },
    ],
  },
  {
    id: "G06-two-receipts-one-thread", findings: ["F-10", "F-14"], title: "Two receipts with two roles in one Gmail thread; corrupted role text (audit #16)", company: "Ripple Systems", now: NOW, indeterminate: true,
    note: "The audit says Gmail holds one message, but the product stored two distinct message ids with two roles in one thread. Truth is indeterminate; only invariants that hold either way are asserted.",
    events: [
      { id: "g06-1", at: "2026-09-25T10:00:00Z", type: "applied", role: "Full Stack Software Engineer Intern - Summer 2027Â", thread: "g06-T" },
      { id: "g06-2", at: "2026-09-25T10:00:20Z", type: "applied", role: "Software Engineer Intern - Backend Focused - Summer 2027", thread: "g06-T" },
    ],
    facets: [
      { cat: "idempotency", kind: "uniqueEvents", why: "one stored event per Gmail message id, always" },
      { cat: "role", kind: "role", of: "g06-1", excludes: "Â", why: "no mojibake in a displayed role" },
    ],
  },
  {
    id: "G07-expired-assessment", findings: ["F-03", "F-09", "F-11"], title: "Assessment request explicitly expired, opportunity still active for 54 days (audit #4)", company: "Prism Analytics", now: NOW,
    events: [
      { id: "g07-1", at: "2026-09-25", type: "assessment", signals: ["assessment", "body"] },
      { id: "g07-2", at: "2026-09-25", type: "assessment", date: "2026-09-28", signals: ["assessment", "subject", "role-inherited"] },
      { id: "g07-3", at: "2026-09-26", type: "assessment", date: "2026-09-27", signals: ["assessment", "subject", "role-inherited"] },
      { id: "g07-4", at: "2026-09-28", type: "status_update", signals: ["request expired", "subject", "role-inherited"] },
    ],
    facets: [
      { cat: "terminal", kind: "active", of: "g07-4", is: false, why: "an explicitly expired request that would archive the application is not an active assessment" },
      { cat: "review", kind: "contradictionFlagged", of: "g07-4", why: "if the product still calls it active it must raise an important review item; it may never say 'nothing important'" },
      { cat: "actions", kind: "noNeedsYou", of: "g07-4", why: "an expired request is not a task for today" },
    ],
  },
  {
    id: "G08-expired-after-reminders", findings: ["F-04", "F-11"], title: "Reminders then explicit expiry; opportunity stays active (audit #18)", company: "Kestrel Ventures", now: NOW,
    note: "The stored Oct 8 reminder carries date Oct 15 (the product's relative-date drift, reproduced at the ingestion layer in dev/ingestion).",
    events: [
      { id: "g08-1", at: "2026-09-25", type: "assessment", date: "2026-10-08", signals: ["assessment", "subject"] },
      { id: "g08-2", at: "2026-10-01", type: "assessment", date: "2026-10-08", signals: ["assessment", "subject"] },
      { id: "g08-3", at: "2026-10-08", type: "assessment", date: "2026-10-15", signals: ["assessment", "subject"] },
      { id: "g08-4", at: "2026-10-09", type: "status_update", signals: ["request expired", "subject"] },
    ],
    facets: [
      { cat: "terminal", kind: "active", of: "g08-4", is: false, why: "expiry supersedes earlier reminders" },
      { cat: "review", kind: "contradictionFlagged", of: "g08-4", why: "stage contradicts terminal evidence" },
    ],
  },
  {
    id: "G09-non-recruiting-assessment", findings: ["F-08", "F-11"], title: "Generic personality-assessment results became an active opportunity (audit #13)", company: "Insight Profiles Institute", now: NOW,
    note: "Two assessment_completed events and nothing else: no application, recruiter, interview or offer evidence.",
    events: [
      { id: "g09-1", at: "2026-07-20", type: "assessment_completed", signals: ["assessment received", "subject"], fc: { type: 0.9, company: 0.69, role: 0.6 } },
      { id: "g09-2", at: "2026-07-20", type: "assessment_completed", signals: ["assessment received", "subject", "role-inherited"], fc: { type: 0.95, company: 0.39, role: 0.4 } },
    ],
    facets: [
      { cat: "false-positive", kind: "active", of: "g09-1", is: false, why: "without evidence of a candidacy this is not a pipeline opportunity" },
    ],
  },
  {
    id: "G10-assessment-no-role", findings: [], title: "Assessment invitation with a 30-day window and no role (audit #3)", company: "Evergreen Labs", now: NOW,
    events: [{ id: "g10-1", at: "2026-11-18T09:00:00Z", type: "assessment", date: "2026-12-18", signals: ["assessment", "subject"], fc: { type: 0.9, company: 0.46, role: 0 } }],
    facets: [
      { cat: "regression", kind: "stage", of: "g10-1", is: "assessment", why: "matches the audit: stays an assessment" },
      { cat: "regression", kind: "active", of: "g10-1", is: true, why: "a fresh assessment with a deadline is active" },
    ],
  },
  // ---- cases the audit found correct: they must keep passing through every milestone ----
  {
    id: "P01-rejection-lifecycle-a", findings: [], title: "Application then explicit rejection (audit #5, #6, #14)", company: "Larkspur Software", now: NOW,
    events: [
      { id: "p01-1", at: "2026-09-09", type: "applied", role: "Software Engineering Intern (Summer 2027)" },
      { id: "p01-2", at: "2026-11-09", type: "rejection", role: "Software Engineering Intern (Summer 2027)" },
    ],
    facets: [
      { cat: "regression", kind: "mustLink", a: "p01-1", b: "p01-2", why: "one lifecycle" },
      { cat: "regression", kind: "active", of: "p01-2", is: false, why: "rejected is closed" },
      { cat: "regression", kind: "outcome", of: "p01-2", is: "rejected", why: "outcome rejected" },
    ],
  },
  {
    id: "P02-rejection-names-requisition", findings: [], title: "Single rejection naming the role (audit #15)", company: "Fennel Financial", now: NOW,
    events: [{ id: "p02-1", at: "2026-10-02", type: "rejection", role: "Summer 2027 Actuary Intern" }],
    facets: [{ cat: "regression", kind: "active", of: "p02-1", is: false, why: "closed" }, { cat: "regression", kind: "outcome", of: "p02-1", is: "rejected", why: "rejected" }],
  },
  {
    id: "P03-applied-single", findings: [], title: "Application receipt for a named role (audit #7)", company: "Linden Network", now: NOW,
    events: [{ id: "p03-1", at: "2026-10-20", type: "applied", role: "Software Engineer Intern, Undergraduate - Summer 2027" }],
    facets: [{ cat: "regression", kind: "stage", of: "p03-1", is: "applied", why: "applied" }, { cat: "regression", kind: "active", of: "p03-1", is: true, why: "active" }],
  },
  {
    id: "P04-applied-then-update", findings: [], title: "Application then an 'evaluation ongoing' update (audit #8)", company: "Dockside Delivery", now: NOW,
    events: [
      { id: "p04-1", at: "2026-09-17", type: "applied", role: "Summer 2027 SWE Intern" },
      { id: "p04-2", at: "2026-10-14", type: "status_update", role: "Summer 2027 SWE Intern" },
    ],
    facets: [{ cat: "regression", kind: "mustLink", a: "p04-1", b: "p04-2", why: "one lifecycle" }, { cat: "regression", kind: "stage", of: "p04-2", is: "applied", why: "a neutral update does not move the stage" }],
  },
  {
    id: "P05-reminders-then-rejection", findings: [], title: "Incomplete-application reminders, then non-selection (audit #12)", company: "Marshall Leadership Fund", now: NOW,
    events: [
      { id: "p05-1", at: "2026-05-02", type: "follow_up", signals: ["unfinished application reminder"] },
      { id: "p05-2", at: "2026-05-20", type: "follow_up", signals: ["unfinished application reminder"] },
      { id: "p05-3", at: "2026-06-19", type: "rejection" },
    ],
    facets: [{ cat: "regression", kind: "active", of: "p05-3", is: false, why: "closed after rejection" }],
  },
  {
    id: "P06-reapply-invitation-after-rejection", findings: [], title: "Rejection that invites re-applying next term (audit #21)", company: "Synapse Interfaces", now: NOW,
    events: [
      { id: "p06-1", at: "2026-08-24", type: "applied", role: "Software Engineer Intern, Neural Interface Applications" },
      { id: "p06-2", at: "2026-11-07", type: "rejection", role: "Software Engineer Intern, Neural Interface Applications" },
    ],
    facets: [{ cat: "regression", kind: "active", of: "p06-2", is: false, why: "closed" }],
  },
  {
    id: "P07-user-override-preserved", findings: [], title: "A person's own correction survives (audit #19)", company: "Meridian Civic Hack", now: NOW, indeterminate: true,
    note: "Gmail alone cannot say whether the current state is right; the person set it. It must stay theirs.",
    events: [
      { id: "p07-1", at: "2026-09-10", type: "applied", role: "2027 Summer Internship" },
      { id: "p07-2", at: "2026-09-21", type: "status_update", role: "2027 Summer Internship" },
      { id: "p07-3", at: "2026-10-05", type: "rejection", role: "2027 Summer Internship", corrected: true, fc: { type: 1, company: 1, role: 1 } },
    ],
    facets: [
      { cat: "regression", kind: "keepsCorrection", of: "p07-3", why: "the person's edit stays attributed to them" },
      { cat: "regression", kind: "active", of: "p07-3", is: false, why: "their correction closed it; automation must not reopen it" },
    ],
  },
  {
    id: "P08-ambiguous-employer-assessment", findings: [], title: "Assessment from a platform whose employer is unclear (audit #17)", company: "Hedgerow Projects", now: NOW, indeterminate: true,
    note: "Taxonomy is undecided (paid-project onboarding or recruiting). Asserted: the doubt is visible and nothing shouts.",
    events: [{ id: "p08-1", at: "2026-10-06", type: "assessment", fc: { type: 0.95, company: 0.4, role: 0 }, reviewReasons: ["company: weak evidence (subject)"] }],
    facets: [{ cat: "regression", kind: "noNeedsYou", of: "p08-1", why: "an unclear-employer assessment never becomes an urgent action" }],
  },
  // ---- dormancy (decision 2026-11-18): 60 days, classification of FOLLOW-UPS only; never closure; exceptions preserved ----
  {
    id: "D01-silent-application", findings: [], title: "Application, then 70 days of silence", company: "Quiet Harbor", now: NOW,
    events: [{ id: "d01-1", at: "2026-09-09", type: "applied", role: "Software Engineer Intern" }],
    facets: [
      { cat: "dormancy", kind: "active", of: "d01-1", is: true, why: "silence is not rejection or closure" },
      { cat: "dormancy", kind: "noNeedsYou", of: "d01-1", why: "a dormant application is not a task for today" },
    ],
  },
  {
    id: "D02-upcoming-interview-exception", findings: [], title: "Last activity 70 days ago but an interview is in 3 days", company: "Slow Burn Systems", now: NOW,
    events: [
      { id: "d02-1", at: "2026-09-09", type: "applied", role: "Data Engineer Intern" },
      { id: "d02-2", at: "2026-09-10", type: "interview_scheduled", role: "Data Engineer Intern", date: "2026-11-21T16:00:00Z" },
    ],
    facets: [{ cat: "dormancy", kind: "action", of: "d02-2", actionKind: "upcoming_interview", present: true, why: "a known upcoming interview is never dormant" }],
  },
  {
    id: "D03-open-offer-exception", findings: [], title: "Offer with a deadline in 3 days, last mail long ago", company: "Offer Hill", now: NOW,
    events: [
      { id: "d03-1", at: "2026-09-01", type: "applied", role: "Product Intern" },
      { id: "d03-2", at: "2026-09-09", type: "offer", role: "Product Intern", date: "2026-11-21" },
    ],
    facets: [{ cat: "dormancy", kind: "action", of: "d03-2", actionKind: "offer_decision", present: true, why: "an open offer with a deadline is never dormant" }],
  },
];
