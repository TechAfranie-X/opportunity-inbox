import { stageOfEvent } from "./opportunity.ts";
import { daysBetween } from "./format.ts";
import type { EffectiveEvent, EventType, Opportunity, Stage } from "./types.ts";

export type TimelineItem = {
  event: EffectiveEvent;
  /** Display label, aware of context: "Interview rescheduled", "Assessment reminder". */
  label: string;
  /** Major events carry the story; minor ones (replies, updates, reminders) recede. */
  major: boolean;
  /** A scheduled time that a later event replaced. History keeps it, visibly set aside. */
  superseded: boolean;
  /** The scheduled time that is true right now. */
  current: boolean;
};

const MINOR: EventType[] = ["user_reply", "status_update", "follow_up"];

const BASE_LABEL: Record<EventType, string> = {
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

/**
 * Turn raw events into a readable history. The interesting case is rescheduling:
 * a second `interview_scheduled` with a different time becomes "Interview rescheduled",
 * the first is marked superseded, and the last one is flagged as the current time.
 */
export function annotateTimeline(events: EffectiveEvent[]): TimelineItem[] {
  const items: TimelineItem[] = events.map((event) => ({
    event,
    label: BASE_LABEL[event.type],
    major: !MINOR.includes(event.type),
    superseded: false,
    current: false,
  }));

  let lastScheduled: TimelineItem | null = null;
  let seenAssessment = false;
  let assessmentDone = false;
  let seenOffer = false;
  let seenApplied = false;

  for (const item of items) {
    const { type, eventDate } = item.event;

    if (type === "interview_scheduled") {
      if (lastScheduled) {
        const sameTime = lastScheduled.event.eventDate?.getTime() === eventDate?.getTime();
        if (sameTime) {
          item.label = "Interview confirmed";
        } else {
          item.label = "Interview rescheduled";
          lastScheduled.superseded = true;
        }
        lastScheduled.current = false;
      }
      item.current = true;
      lastScheduled = item;
    }

    if (type === "assessment") {
      if (seenAssessment && !assessmentDone) {
        item.label = "Assessment reminder";
        item.major = false;
      }
      seenAssessment = true;
    }
    if (type === "assessment_completed") assessmentDone = true;

    if (type === "offer") {
      if (seenOffer) item.label = "Offer updated";
      seenOffer = true;
    }
    if (type === "applied") {
      if (seenApplied) {
        item.label = "Application confirmed again";
        item.major = false;
      }
      seenApplied = true;
    }
  }
  return items;
}

/** The first moment in the current stage's trailing run, e.g. when "Interview" began. */
export function stageSince(opportunity: Opportunity): Date {
  const stage = opportunity.stage;
  let since = opportunity.events[opportunity.events.length - 1].occurredAt;
  for (let i = opportunity.events.length - 1; i >= 0; i -= 1) {
    const s = stageOfEvent(opportunity.events[i].type);
    if (s === null) continue; // neutral events don't end a stage
    if (s !== stage) break;
    since = opportunity.events[i].occurredAt;
  }
  return since;
}

export type NextMoment = { label: string; date: Date; hasTime: boolean; kind: "scheduled" | "deadline" };

/** The nearest future date that matters: an interview time, an assessment due date or an offer deadline. */
export function nextMoment(opportunity: Opportunity, now: Date): NextMoment | null {
  const candidates: NextMoment[] = [];
  const scheduled = [...opportunity.events].reverse().find((e) => e.type === "interview_scheduled" && e.eventDate);
  if (scheduled?.eventDate && daysBetween(now, scheduled.eventDate) >= 0) {
    candidates.push({ label: "Interview", date: scheduled.eventDate, hasTime: scheduled.eventDateHasTime, kind: "scheduled" });
  }
  const assessment = [...opportunity.events].reverse().find((e) => e.type === "assessment" && e.eventDate);
  if (assessment?.eventDate && daysBetween(now, assessment.eventDate) >= 0 && !opportunity.events.some((e) => e.type === "assessment_completed" && e.occurredAt > assessment.occurredAt)) {
    candidates.push({ label: "Assessment due", date: assessment.eventDate, hasTime: assessment.eventDateHasTime, kind: "deadline" });
  }
  const offer = [...opportunity.events].reverse().find((e) => e.type === "offer" && e.eventDate);
  if (offer?.eventDate && daysBetween(now, offer.eventDate) >= 0) {
    candidates.push({ label: "Offer decision", date: offer.eventDate, hasTime: offer.eventDateHasTime, kind: "deadline" });
  }
  return candidates.sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;
}

const NOT_A_PERSON = /no-?reply|careers|recruiting|talent|team|hiring|notifications?|workday|system|greenhouse|lever|ashby|support|admin|hr\b|\d|@|\binc\b|\bllc\b/i;

/** Distinct people who wrote to you (not mailers), most recent first. Empty when senders are all systems. */
export function peopleFor(opportunity: Opportunity, limit = 3): string[] {
  const seen = new Set<string>();
  const people: string[] = [];
  for (const e of [...opportunity.events].reverse()) {
    if (e.outbound) continue;
    const name = e.senderName.replace(/\s+/g, " ").trim();
    const words = name.split(" ");
    if (words.length < 2 || words.length > 3) continue;
    if (!words.every((w) => /^[A-Z][a-z'’-]+$/.test(w))) continue;
    if (NOT_A_PERSON.test(name) || name.toLowerCase() === opportunity.company.toLowerCase()) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    people.push(name);
    if (people.length >= limit) break;
  }
  return people;
}

export const PULSE_STAGES: Stage[] = ["applied", "recruiter", "assessment", "interview", "offer"];

/** Active opportunities per stage, in funnel order. */
export function pulse(opportunities: Opportunity[]): Array<{ stage: Stage; count: number }> {
  const active = opportunities.filter((o) => o.status === "active");
  return PULSE_STAGES.map((stage) => ({ stage, count: active.filter((o) => o.stage === stage).length }));
}

/** Which dot on the journey line is current, and how many are reached. */
export function journeyPosition(stage: Stage): { index: number; closed: boolean } {
  if (stage === "closed") return { index: -1, closed: true };
  return { index: PULSE_STAGES.indexOf(stage), closed: false };
}

/** The last thing that actually moved the process, not a reply or a generic update. */
export function lastMeaningful(opportunity: Opportunity): { label: string; at: Date; scheduled: Date | null } {
  const quiet = new Set<EventType>(["user_reply", "status_update", "follow_up"]);
  const event = [...opportunity.events].reverse().find((e) => !quiet.has(e.type)) ?? opportunity.events[opportunity.events.length - 1];
  const annotated = annotateTimeline(opportunity.events).find((i) => i.event === event);
  return {
    label: annotated?.label ?? BASE_LABEL[event.type],
    at: event.occurredAt,
    scheduled: event.type === "interview_scheduled" ? event.eventDate : null,
  };
}
