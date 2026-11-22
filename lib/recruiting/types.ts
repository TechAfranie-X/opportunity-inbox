/**
 * Core domain types for the recruiting-lifecycle model.
 *
 * Everything here is derived from email but deliberately contains NO email body
 * text. `RecruitingEmail.bodyText` exists only as transient input to extraction.
 */

export type EventType =
  | "applied" // application confirmation
  | "recruiter_outreach" // recruiter reached out / wants to talk
  | "assessment" // OA / coding challenge / take-home assigned
  | "assessment_completed" // submission acknowledged
  | "interview_invite" // asked to schedule an interview (needs a reply)
  | "interview_scheduled" // interview confirmed with a date/time
  | "follow_up" // nudge from either side / status check
  | "status_update" // generic "an update on your application": we could not tell what it means
  | "offer"
  | "rejection"
  | "withdrawn" // user withdrew
  | "user_reply"; // user sent a message (outbound)

export const EVENT_TYPES: EventType[] = [
  "applied",
  "recruiter_outreach",
  "assessment",
  "assessment_completed",
  "interview_invite",
  "interview_scheduled",
  "follow_up",
  "status_update",
  "offer",
  "rejection",
  "withdrawn",
  "user_reply",
];

export type Stage =
  | "applied"
  | "recruiter"
  | "assessment"
  | "interview"
  | "offer"
  | "closed";

export const STAGES: Stage[] = [
  "applied",
  "recruiter",
  "assessment",
  "interview",
  "offer",
  "closed",
];

/** `accepted`: an offer followed by onboarding paperwork from the employer (screening, start details): the offer is settled, not waiting for a decision. */
export type Outcome = "offer" | "accepted" | "rejected" | "withdrawn" | "expired" | null;

/** A single message as handed to the extractor. Body is transient. */
export type RecruitingEmail = {
  id: string;
  threadId: string;
  from: string;
  /** Reply-To header, when present. Transient evidence for company resolution; never stored. */
  replyTo?: string;
  subject: string;
  receivedAt: Date;
  outbound: boolean;
  bodyText: string;
  /** Gmail's own labels for the message (INBOX, IMPORTANT, CATEGORY_*). Transient evidence for the reader; never stored. */
  labels?: string[];
  /** The text is in the message but Gmail did not inline it, so `bodyText` is empty for a reason other than "nothing there". */
  bodyUnreadable?: boolean;
};

/** What we persist per email. No body, no snippet. */
export type ExtractedEvent = {
  gmailMessageId: string;
  gmailThreadId: string;
  occurredAt: Date;
  outbound: boolean;
  senderName: string;
  senderDomain: string;
  subject: string;
  type: EventType;
  company: string | null;
  role: string | null;
  /** Floating (timezone-less) date/time stored as UTC. */
  eventDate: Date | null;
  eventDateHasTime: boolean;
  dateKind: "deadline" | "scheduled" | null;
  /** 0..1 — how sure the extractor is about the event type + company. */
  confidence: number;
  /** Per-field confidence, 0..1. Absent on older rows. Thresholds live in policy.ts. */
  fieldConfidence?: { type: number; company: number; role: number };
  /** Plain-language reasons a field is doubtful (evidence, never message text). */
  reviewReasons?: string[];
  signals: string[];
};

/** Extracted values merged with user corrections. */
export type EffectiveEvent = ExtractedEvent & {
  /** Persisted row id (undefined for demo/fixture events). */
  id: string;
  corrected: boolean;
  /** The person pressed "Looks right" on this event. */
  confirmed?: boolean;
  /** The person said this message belongs with that one (a Gmail message id): applied before any automatic linking. */
  linkedTo?: string;
  /** The person said this message is its own opportunity: it never links automatically to earlier ones. */
  separate?: boolean;
};

export type Opportunity = {
  key: string;
  company: string;
  role: string | null;
  stage: Stage;
  outcome: Outcome;
  /** Whether the opportunity is still open. Separate from `stage`, which is how far it got. */
  status: "active" | "closed";
  /** Why it is closed: an employer/person ending, an expired request, or no evidence of a candidacy. Null while active. */
  closedBy?: "rejected" | "withdrawn" | "expired" | "not_recruiting" | "completed" | null;
  /** The ending rests on one uncorroborated automated reading (decision engine, shadow): shown as "likely ended, please confirm" once the product uses it. */
  closureProposed?: boolean;
  /** One uncorroborated reading says this application ended; it is NOT settled and the application stays active and visible. */
  proposedEnding?: { outcome: "rejected" | "withdrawn"; eventId: string };
  /** A person's "Looks right" on a reading that a later, independent reading of the same message disagrees with (lib/recruiting/confirmation-conflicts.ts). Never overrides the confirmation. */
  confirmationConflicts?: Array<{ eventId: string; text: string }>;
  /** Keys the previous scheme gave to the applications this one continues, so old overrides, dismissals and links still resolve. */
  legacyKeys?: string[];
  firstActivityAt: Date;
  lastActivityAt: Date;
  events: EffectiveEvent[]; // chronological
  /** Lowest-confidence event, so the UI can nudge "check this". */
  needsReview: boolean;
  /** Competing evidence inside this opportunity that a person should look at (lib/lifecycle/contradictions.ts). */
  contradictions?: Array<{ kind: "reopened" | "offer_ended" | "ambiguous_identity" | "mixed_cycles"; eventIds: string[]; text: string }>;
  /** What kind of opportunity this is. Scholarships and mentorship programs are real applications but not employer recruiting. Absent = job or internship. */
  kind?: OpportunityKind;
  /** Programme journeys only: where the person is in the programme (lib/lifecycle/program.ts). A programme is never a job stage. */
  programState?: import("../lifecycle/program.ts").ProgramState;
};

export type OpportunityKind = "job" | "scholarship" | "mentorship" | "event";

export type ActionKind =
  | "program_deadline"
  | "assessment_deadline"
  | "upcoming_interview"
  | "schedule_interview"
  | "respond_recruiter"
  | "offer_decision"
  | "follow_up"
  | "check_in";

export type ActionItem = {
  /** Stable id so dismissals persist across syncs. */
  id: string;
  kind: ActionKind;
  opportunityKey: string;
  company: string;
  role: string | null;
  title: string;
  reason: string;
  due: Date | null;
  dueHasTime: boolean;
  bucket: "overdue" | "today" | "soon" | "worth_a_look";
  /** True when the evidence behind this action is too uncertain to show it as urgent. */
  uncertain?: boolean;
  /** A quiet-for-60-days suggestion (never a status: nothing is closed by silence). Shown low, inside its own collapsed group. */
  dormant?: boolean;
  priority: number;
  sourceThreadId: string | null;
};
