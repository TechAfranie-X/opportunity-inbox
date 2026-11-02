import { companyKey, roleRelation, roleTokens } from "./company.ts";
import { decide, DEFAULT_POLICY, type Policy } from "./policy.ts";
import type {
  EffectiveEvent,
  EventType,
  ExtractedEvent,
  Opportunity,
  Outcome,
  Stage,
} from "./types.ts";

/** A user's correction to one extracted event. Absent field = keep extracted value. */
export type EventCorrection = {
  ignored?: boolean;
  type?: EventType;
  company?: string;
  role?: string | null;
  /** `null` clears the date; undefined keeps the extracted one. */
  eventDate?: Date | null;
};

export type OpportunityOverride = { status?: "closed" | "active" };

export function applyCorrection(
  event: ExtractedEvent & { id: string },
  correction: EventCorrection | undefined,
): EffectiveEvent | null {
  if (!correction) return { ...event, corrected: false };
  if (correction.ignored) return null;
  const merged: EffectiveEvent = { ...event, corrected: false };
  if (correction.type !== undefined) { merged.type = correction.type; merged.corrected = true; }
  if (correction.company !== undefined) { merged.company = correction.company; merged.corrected = true; }
  if (correction.role !== undefined) { merged.role = correction.role; merged.corrected = true; }
  if (correction.eventDate !== undefined) {
    merged.eventDate = correction.eventDate;
    merged.corrected = true;
    if (correction.eventDate && !merged.dateKind) merged.dateKind = merged.type === "interview_scheduled" ? "scheduled" : "deadline";
    if (!correction.eventDate) merged.dateKind = null;
  }
  if (merged.corrected) merged.confidence = 1;
  return merged;
}

const STAGE_OF: Partial<Record<EventType, Stage>> = {
  applied: "applied",
  recruiter_outreach: "recruiter",
  assessment: "assessment",
  assessment_completed: "assessment",
  interview_invite: "interview",
  interview_scheduled: "interview",
  offer: "offer",
  rejection: "closed",
  withdrawn: "closed",
};

export function stageOfEvent(type: EventType): Stage | null {
  return STAGE_OF[type] ?? null;
}

type Group = {
  company: string | null;
  role: string | null;
  events: EffectiveEvent[];
  threads: Set<string>;
};

function lastActivity(group: Group) {
  return group.events[group.events.length - 1].occurredAt.getTime();
}

/** A generic-role event only joins an opportunity that was active within this window. */
const GENERIC_ROLE_WINDOW_MS = 90 * 86_400_000;
/** After a rejection/withdrawal only these (neutral) events can still belong to the same opportunity. */
const NEUTRAL_AFTER_CLOSE = new Set<EventType>(["status_update", "follow_up", "user_reply"]);

function endedByUser(group: Group) {
  const last = [...group.events].reverse().find((e) => stageOfEvent(e.type) !== null);
  return last?.type === "rejection" || last?.type === "withdrawn";
}

/**
 * Group chronological events into opportunities.
 *
 * Linking rules, strongest first:
 *  1. Same Gmail thread -> same opportunity.
 *  2. Same company + matching role -> same opportunity (unless it already ended).
 *  3. Same company + generic role ("Intern", unknown) -> the most recently active
 *     opportunity at that company within 90 days. Both-specific-and-different roles
 *     are never merged ("Software Engineer" vs "Data Analyst").
 *  4. Otherwise start a new opportunity.
 */
export function groupEvents(events: EffectiveEvent[]): Group[] {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const groups: Group[] = [];
  const byThread = new Map<string, Group>();

  for (const event of sorted) {
    let target = byThread.get(event.gmailThreadId);

    if (!target) {
      if (event.company) {
        const ck = companyKey(event.company);
        const candidates = groups.filter((g) => g.company && companyKey(g.company) === ck);
        target =
          candidates.find(
            (g) =>
              roleRelation(g.role, event.role) === "match" &&
              g.role !== null &&
              event.role !== null &&
              // A new application for the same role after a rejection is a new opportunity.
              (!endedByUser(g) || NEUTRAL_AFTER_CLOSE.has(event.type)),
          ) ??
          candidates
            .filter(
              (g) =>
                roleRelation(g.role, event.role) === "generic" &&
                event.occurredAt.getTime() - lastActivity(g) <= GENERIC_ROLE_WINDOW_MS &&
                // A new application/assessment/interview after a rejection is a new application.
                (!endedByUser(g) || NEUTRAL_AFTER_CLOSE.has(event.type)),
            )
            .sort((a, b) => lastActivity(b) - lastActivity(a))[0];
      } else if (event.senderDomain) {
        target = groups.find((g) => !g.company && g.events.some((e) => e.senderDomain === event.senderDomain));
      }
    }

    if (!target) {
      target = { company: event.company, role: event.role, events: [], threads: new Set() };
      groups.push(target);
    }
    target.events.push(event);
    target.threads.add(event.gmailThreadId);
    byThread.set(event.gmailThreadId, target);
    if (!target.company && event.company) target.company = event.company;
    if (!target.role && event.role) target.role = event.role;
  }
  return groups;
}

function deriveState(events: EffectiveEvent[]): { stage: Stage; outcome: Outcome } {
  let stage: Stage = "applied";
  let outcome: Outcome = null;
  for (const e of events) {
    const s = stageOfEvent(e.type);
    if (!s) continue;
    stage = s;
    outcome = e.type === "rejection" ? "rejected" : e.type === "withdrawn" ? "withdrawn" : e.type === "offer" ? "offer" : null;
  }
  return { stage, outcome };
}

export function opportunityKey(company: string | null, role: string | null, used: Set<string>) {
  const base = `${company ? companyKey(company) : "unknown"}~${roleTokens(role).slice(0, 4).join("-") || "general"}`;
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}~${n}`;
  used.add(key);
  return key;
}

/**
 * Does this event carry a value the policy says to doubt? Uses the field confidences when the row has them,
 * and falls back to the event-level confidence for older rows. A person's own correction settles it.
 */
export function eventNeedsReview(e: EffectiveEvent, policy: Policy = DEFAULT_POLICY): boolean {
  if (e.corrected) return false;
  if (!e.fieldConfidence) return e.confidence < policy.reviewBelow;
  return decide(e.type, e.fieldConfidence.type, policy, "type").state !== "accepted" || (e.company !== null && decide(e.company, e.fieldConfidence.company, policy, "company").state !== "accepted");
}

export function buildOpportunities(
  events: EffectiveEvent[],
  overrides: Map<string, OpportunityOverride> = new Map(),
  policy: Policy = DEFAULT_POLICY,
): Opportunity[] {
  const used = new Set<string>();
  const opportunities = groupEvents(events).map((group): Opportunity => {
    const key = opportunityKey(group.company, group.role, used);
    const { stage, outcome } = deriveState(group.events);
    const override = overrides.get(key);
    const closedByUser = override?.status === "closed";
    const reopened = override?.status === "active";
    const status = (stage === "closed" && !reopened) || closedByUser ? "closed" : "active";
    return {
      key,
      company: group.company ?? "Unknown company",
      role: group.role,
      stage,
      outcome,
      status,
      firstActivityAt: group.events[0].occurredAt,
      lastActivityAt: group.events[group.events.length - 1].occurredAt,
      events: group.events,
      needsReview: !group.company || group.events.some((e) => eventNeedsReview(e, policy)),
    };
  });
  return opportunities.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}
