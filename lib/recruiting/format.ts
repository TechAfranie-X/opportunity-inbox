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
  assessment: "Assessment received",
  assessment_completed: "Assessment completed",
  interview_invite: "Invited to interview",
  interview_scheduled: "Interview scheduled",
  follow_up: "Follow-up",
  status_update: "Update on your application",
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

const WEEKDAY_LONG: Intl.DateTimeFormatOptions = { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" };

/** "Wednesday, November 4 at 2:00 PM" (floating dates, so UTC). */
export function formatWhen(date: Date, withTime: boolean) {
  const day = date.toLocaleDateString("en-US", WEEKDAY_LONG);
  if (!withTime) return day;
  const time = date.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Whole days from `now` to `date` (negative = past), on the floating calendar. */
export function daysBetween(now: Date, date: Date) {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

/** "today", "tomorrow", "in 3 days", "yesterday", "5 days ago", "3 weeks ago". */
export function relativeDay(now: Date, date: Date) {
  const d = daysBetween(now, date);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 1) return d < 14 ? `in ${d} days` : `in ${Math.round(d / 7)} weeks`;
  const past = -d;
  if (past < 14) return `${past} days ago`;
  if (past < 60) return `${Math.round(past / 7)} weeks ago`;
  return `${Math.round(past / 30)} months ago`;
}
