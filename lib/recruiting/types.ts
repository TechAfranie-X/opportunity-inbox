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

export type Outcome = "offer" | "rejected" | "withdrawn" | null;

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
};

export type Opportunity = {
  key: string;
  company: string;
  role: string | null;
  stage: Stage;
  outcome: Outcome;
  status: "active" | "closed";
  firstActivityAt: Date;
  lastActivityAt: Date;
  events: EffectiveEvent[]; // chronological
  /** Lowest-confidence event, so the UI can nudge "check this". */
  needsReview: boolean;
};

export type ActionKind =
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
  priority: number;
  sourceThreadId: string | null;
};
