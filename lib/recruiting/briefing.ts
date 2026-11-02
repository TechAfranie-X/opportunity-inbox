import { EVENT_LABEL, daysBetween, formatWhen, relativeDay } from "./format.ts";
import type { ActionItem, ActionKind, EffectiveEvent, Opportunity } from "./types.ts";

export type RecentChange = {
  opportunityKey: string;
  company: string;
  role: string | null;
  label: string;
  when: Date;
};

export type Briefing = {
  /** Overdue, due today, or landing within two days. The first item is the hero. */
  needsYou: ActionItem[];
  comingUp: ActionItem[];
  /** Quiet follow-up suggestions. Never allowed to compete with the rest. */
  waiting: ActionItem[];
  recent: RecentChange[];
};

const NEEDS_YOU_WITHIN_DAYS = 2;
const RECENT_WINDOW_DAYS = 7;
const RECENT_LIMIT = 5;

/**
 * Sort actions into the briefing's sections. `now` is a floating date.
 * "Needs you" is about consequence and nearness: it also pulls in anything
 * due within two days (the interview on Wednesday matters on Monday).
 */
export function buildBriefing(opportunities: Opportunity[], actions: ActionItem[], now: Date): Briefing {
  const urgent = (a: ActionItem) =>
    a.bucket === "overdue" ||
    a.bucket === "today" ||
    (a.bucket === "soon" && a.due !== null && daysBetween(now, a.due) <= NEEDS_YOU_WITHIN_DAYS);

  const needsYou = actions.filter(urgent);
  const rest = actions.filter((a) => !urgent(a));
  const comingUp = rest.filter((a) => a.bucket === "soon");
  const waiting = rest.filter((a) => a.bucket === "worth_a_look");

  return { needsYou, comingUp, waiting, recent: recentChanges(opportunities, now) };
}

/** The latest inbound event per opportunity within the last week, newest first. */
export function recentChanges(opportunities: Opportunity[], now: Date): RecentChange[] {
  const cutoff = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000;
  const changes: RecentChange[] = [];
  for (const opp of opportunities) {
    const latest = [...opp.events]
      .reverse()
      .find((e: EffectiveEvent) => !e.outbound && e.occurredAt.getTime() >= cutoff && e.type !== "status_update");
    if (latest) {
      changes.push({
        opportunityKey: opp.key,
        company: opp.company,
        role: opp.role,
        label: EVENT_LABEL[latest.type],
        when: latest.occurredAt,
      });
    }
  }
  return changes.sort((a, b) => b.when.getTime() - a.when.getTime()).slice(0, RECENT_LIMIT);
}

const HEADLINE: Record<ActionKind, (company: string) => string> = {
  upcoming_interview: (c) => `Interview with ${c}`,
  schedule_interview: (c) => `Reply to ${c} to book your interview`,
  respond_recruiter: (c) => `Reply to the ${c} recruiter`,
  assessment_deadline: (c) => `${c} assessment`,
  offer_decision: (c) => `Your ${c} offer`,
  follow_up: (c) => `Follow up with ${c}`,
  check_in: (c) => `Check in with ${c}`,
};

const PRIMARY_LABEL: Record<ActionKind, string> = {
  upcoming_interview: "Open the invite",
  schedule_interview: "Open the email",
  respond_recruiter: "Open the email",
  assessment_deadline: "Open the assessment",
  offer_decision: "Open the offer",
  follow_up: "Open the thread",
  check_in: "Open the thread",
};

export type ActionCopy = {
  headline: string;
  /** When it happens or is due, in words. Null when the item has no date. */
  when: string | null;
  /** The same moment, relative ("in 2 days"). */
  relative: string | null;
  primaryLabel: string;
  /** True when the date is past or today, i.e. the only place the signal colour is allowed. */
  critical: boolean;
};

export function describeAction(action: ActionItem, now: Date): ActionCopy {
  const days = action.due ? daysBetween(now, action.due) : null;
  return {
    headline: HEADLINE[action.kind](action.company),
    when: action.due ? formatWhen(action.due, action.dueHasTime) : null,
    relative: action.due ? relativeDay(now, action.due) : null,
    primaryLabel: PRIMARY_LABEL[action.kind],
    critical: action.bucket === "overdue" || (days !== null && days <= 0),
  };
}
