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

const GMAIL_ADDRESS = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** The address to put in a Gmail link, or null: only a well-formed address of a real connected account (never the synthetic sample mailbox). */
export function gmailAccountForLinks(email: string | null | undefined, sample = false): string | null {
  return !sample && email && GMAIL_ADDRESS.test(email.trim()) ? email.trim() : null;
}

/**
 * A link to a Gmail conversation that opens in the CONNECTED account. Gmail numbers signed-in accounts by slot (`/u/0/`, `/u/1/`...) and the slot differs by browser
 * profile and changes when a person signs in or out, so a slot is never assumed. `authuser=<address>` names the account itself and works in every profile that
 * has it signed in; if it is not signed in Gmail asks which account to use. Without an account (sample mailbox, demo) the link carries no account hint.
 */
export function gmailThreadUrl(threadId: string, account?: string | null) {
  const who = gmailAccountForLinks(account);
  return `https://mail.google.com/mail/${who ? `?authuser=${encodeURIComponent(who)}` : ""}#all/${encodeURIComponent(threadId)}`;
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

/** "We think this is ___": the event as a noun phrase, with its article. */
export const EVENT_NOUN: Record<EventType, string> = {
  applied: "an application confirmation",
  recruiter_outreach: "a recruiter reaching out",
  assessment: "an assessment",
  assessment_completed: "an assessment receipt",
  interview_invite: "an interview invitation",
  interview_scheduled: "a scheduled interview",
  follow_up: "a follow-up",
  status_update: "a status update",
  offer: "an offer",
  rejection: "a rejection",
  withdrawn: "a withdrawal",
  user_reply: "your own reply",
};

/** A short, scannable time for cards: "Today 2:00 PM", "Tomorrow", "Wed 11:59 PM" within a week, "Nov 18" beyond. */
export function compactWhen(now: Date, date: Date, withTime: boolean): string {
  const d = daysBetween(now, date);
  const time = withTime ? date.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }) : "";
  if (d === 0) return `Today${time ? ` ${time}` : ""}`;
  if (d === 1) return `Tomorrow${time ? ` ${time}` : ""}`;
  if (d > 1 && d < 7) return `${date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })}${time ? ` ${time}` : ""}`;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** The line under a company name: the role, or what kind of application this is when no role applies, or an honest "No role detected". */
export function roleLine(o: { role: string | null; kind?: "job" | "scholarship" | "mentorship" | "event" }): string {
  if (o.role) return o.role;
  return o.kind === "scholarship" ? "Scholarship or fellowship" : o.kind === "mentorship" ? "Mentorship application" : o.kind === "event" ? "Workshop, conference or event" : "No role detected";
}

/** Job and internship applications drive the pipeline counts. Scholarships and mentorship programs are kept and shown, but counted apart. */
export const isJob = (o: { kind?: "job" | "scholarship" | "mentorship" | "event" }) => (o.kind ?? "job") === "job";
