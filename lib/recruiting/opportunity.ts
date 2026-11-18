import { groupEventsV2, groupRole } from "../lifecycle/identity.ts";
import { assignKeys } from "../lifecycle/keys.ts";
import { legacyKeyHeads } from "../lifecycle/legacy.ts";
import { refineEvents } from "../lifecycle/refine.ts";
import { reduceLifecycle } from "../lifecycle/reducer.ts";
import { repairText } from "../lifecycle/text.ts";
import { decide, DEFAULT_POLICY, type Policy } from "./policy.ts";
import { hasDoubt } from "../reliability/flags.ts";
import type {
  EffectiveEvent,
  EventType,
  ExtractedEvent,
  Opportunity,
  Stage,
} from "./types.ts";

/** A user's correction to one extracted event. Absent field = keep extracted value. */
export type EventCorrection = {
  ignored?: boolean;
  /** "Looks right": the person checked what we read. Changes no value; it settles the doubt so the item leaves the review queue. */
  confirmed?: boolean;
  /** Durable link constraints (lib/lifecycle/identity.ts): they survive re-reading and regrouping because they live on the event. */
  linkedTo?: string;
  separate?: boolean;
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
  const merged: EffectiveEvent = { ...event, corrected: false, ...(correction.confirmed ? { confirmed: true } : {}), ...(correction.linkedTo ? { linkedTo: correction.linkedTo } : {}), ...(correction.separate ? { separate: true } : {}) };
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

/**
 * Group chronological events into opportunities (lib/lifecycle/identity.ts). A Gmail thread is evidence, never a command; cycle (season and year), specific
 * role and program are identity; a person's `linkedTo` / `separate` constraints are applied first. See docs/lifecycle-identity-v2-design.md.
 */
export function groupEvents(events: EffectiveEvent[]) {
  return groupEventsV2(events).map((g) => ({ company: g.company, role: groupRole(g), events: g.events, threads: g.threads }));
}

/**
 * Does this event carry a value the policy says to doubt? Uses the field confidences when the row has them,
 * and falls back to the event-level confidence for older rows. A person's own correction settles it.
 */
export function eventNeedsReview(e: EffectiveEvent, policy: Policy = DEFAULT_POLICY): boolean {
  if (e.corrected || e.confirmed) return false;
  if (hasDoubt(e)) return true; // doubt about whether it is hiring mail at all outranks doubt about its details
  if (!e.fieldConfidence) return e.confidence < policy.reviewBelow;
  return decide(e.type, e.fieldConfidence.type, policy, "type").state !== "accepted" || (e.company !== null && decide(e.company, e.fieldConfidence.company, policy, "company").state !== "accepted");
}

export function buildOpportunities(
  events: EffectiveEvent[],
  overrides: Map<string, OpportunityOverride> = new Map(),
  policy: Policy = DEFAULT_POLICY,
): Opportunity[] {
  events = refineEvents(events).events; // evidence checks that need the whole record (lib/lifecycle/refine.ts)
  const groups = groupEventsV2(events);
  const keys = assignKeys(groups);
  // Keys the previous scheme gave: each old key belongs to the opportunity that holds its most recent event, so old overrides, dismissals and bookmarks resolve.
  const ownerOfEvent = new Map<string, number>();
  groups.forEach((g, i) => g.events.forEach((e) => ownerOfEvent.set(e.id, i)));
  const legacy: string[][] = groups.map(() => []);
  for (const [oldKey, head] of legacyKeyHeads(events)) { const i = ownerOfEvent.get(head); if (i !== undefined) legacy[i].push(oldKey); }
  const opportunities = groups.map((group, i): Opportunity => {
    const key = keys[i];
    const { stage, outcome, status: derived, closedBy } = reduceLifecycle(group.events, policy);
    const override = overrides.get(key) ?? legacy[i].map((k) => overrides.get(k)).find(Boolean);
    const closedByUser = override?.status === "closed";
    const reopened = override?.status === "active";
    const status = (derived === "closed" && !reopened) || closedByUser ? "closed" : "active";
    return {
      key,
      company: group.company ?? "Unknown company",
      role: repairText(groupRole(group)),
      stage,
      outcome,
      status,
      closedBy: status === "closed" ? (closedBy ?? "rejected") : null,
      legacyKeys: legacy[i],
      firstActivityAt: group.events[0].occurredAt,
      lastActivityAt: group.events[group.events.length - 1].occurredAt,
      events: group.events,
      needsReview: !group.company || group.events.some((e) => eventNeedsReview(e, policy)) || closedBy === "not_recruiting",
    };
  });
  return opportunities.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}
