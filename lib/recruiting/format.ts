import type { EventType, Stage } from "./types.ts";

export const STAGE_LABEL: Record<Stage, string> = {
  applied: "Applied",
  recruiter: "Recruiter",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  closed: "Closed",
};

export const EVENT_LABEL: Record<EventType, string> = {
  applied: "Applied",
  recruiter_outreach: "Recruiter reached out",
  assessment: "Assessment assigned",
  assessment_completed: "Assessment submitted",
  interview_invite: "Asked to schedule interview",
  interview_scheduled: "Interview scheduled",
  follow_up: "Follow-up",
  offer: "Offer",
  rejection: "Rejection",
  withdrawn: "You withdrew",
  user_reply: "You replied",
};

/** Floating dates are stored as UTC wall-clock, so always format in UTC. */
export function formatFloating(date: Date, withTime: boolean) {
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function formatDay(date: Date) {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** `<input type=datetime-local>` value for a floating date. */
export function toInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 16) : "";
}

export function fromInputValue(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function gmailThreadUrl(threadId: string) {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}
