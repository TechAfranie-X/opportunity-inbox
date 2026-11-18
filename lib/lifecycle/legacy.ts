import { companyKey, roleRelation, roleTokens } from "../recruiting/company.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";

/**
 * The PREVIOUS grouping and key scheme, kept only to translate old identifiers (overrides, dismissals, bookmarked URLs) to the new ones by event membership.
 * It is never used to decide what the person sees. See lib/lifecycle/keys.ts.
 */
type Group = { company: string | null; role: string | null; events: EffectiveEvent[]; threads: Set<string> };
const GENERIC_ROLE_WINDOW_MS = 90 * 86_400_000;
const NEUTRAL_AFTER_CLOSE = new Set<EventType>(["status_update", "follow_up", "user_reply"]);
const STAGE_TYPES = new Set<EventType>(["applied", "recruiter_outreach", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"]);
const endedByUser = (g: Group) => { const last = [...g.events].reverse().find((e) => STAGE_TYPES.has(e.type)); return last?.type === "rejection" || last?.type === "withdrawn"; };
const lastActivity = (g: Group) => g.events[g.events.length - 1].occurredAt.getTime();

export function legacyGroupEvents(events: EffectiveEvent[]): Group[] {
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
          candidates.find((g) => roleRelation(g.role, event.role) === "match" && g.role !== null && event.role !== null && (!endedByUser(g) || NEUTRAL_AFTER_CLOSE.has(event.type))) ??
          candidates.filter((g) => roleRelation(g.role, event.role) === "generic" && event.occurredAt.getTime() - lastActivity(g) <= GENERIC_ROLE_WINDOW_MS && (!endedByUser(g) || NEUTRAL_AFTER_CLOSE.has(event.type))).sort((a, b) => lastActivity(b) - lastActivity(a))[0];
      } else if (event.senderDomain) {
        target = groups.find((g) => !g.company && g.events.some((e) => e.senderDomain === event.senderDomain));
      }
    }
    if (!target) { target = { company: event.company, role: event.role, events: [], threads: new Set() }; groups.push(target); }
    target.events.push(event);
    target.threads.add(event.gmailThreadId);
    byThread.set(event.gmailThreadId, target);
    if (!target.company && event.company) target.company = event.company;
    if (!target.role && event.role) target.role = event.role;
  }
  return groups;
}

/** Old key: `company~first-four-role-tokens`, with a numeric suffix by order. */
export function legacyOpportunityKey(company: string | null, role: string | null, used: Set<string>) {
  const base = `${company ? companyKey(company) : "unknown"}~${roleTokens(role).slice(0, 4).join("-") || "general"}`;
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}~${n}`;
  used.add(key);
  return key;
}

/** Old key -> the id of that old group's most recent event (the one a person looking at it would have been looking at). */
export function legacyKeyHeads(events: EffectiveEvent[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const g of legacyGroupEvents(events)) out.set(legacyOpportunityKey(g.company, g.role, used), g.events[g.events.length - 1].id);
  return out;
}
