import { companyKey } from "../recruiting/company.ts";
import { classifySender } from "../recruiting/entity/vendors.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { cycleOf, cyclesConflict, isRoleFragment, programsConflict, programsOf, roleCore, roleRelationV2, type Cycle } from "./cycle.ts";

/**
 * THE PREVIOUS IDENTITY ALGORITHM (before Opportunity Intelligence v3), kept only to translate keys it issued (overrides, dismissals, bookmarks) to the current
 * opportunities by event membership, exactly as lifecycle/legacy.ts does for the generation before. It never decides what the person sees.
 *
 * Opportunity identity v2: which stored events belong to the same application.
 *
 * An opportunity is employer + RECRUITING CYCLE + role (+ program). Every automatic link is evidence weighed against hard conflicts:
 *  - a Gmail thread is EVIDENCE that two messages belong together, never a command: Gmail threads automated mail by subject, so a re-application, a second
 *    role or the next season arrives in the same thread. A conflict in cycle, specific role or program overrules the thread;
 *  - cycle (season and year) and program (externship, fellowship, full-time, ...) are identity, not noise;
 *  - a specific role that matches may link across a long gap only with positive cycle evidence; otherwise it must be recent;
 *  - a person's own constraints (`linkedTo`: this event belongs with that message; `separate`: this event is its own opportunity) are applied before any rule and
 *    are never overridden by one. They live on the event's correction, so they survive re-reading and regrouping.
 */
type Group = { company: string | null; events: EffectiveEvent[]; threads: Set<string> };

const DAY = 86_400_000;
const GENERIC_WINDOW = 90 * DAY;
const SPECIFIC_WINDOW_NO_CYCLE = 180 * DAY;
const GENERIC_WINDOW_WITH_THREAD = 240 * DAY;
const NEUTRAL = new Set<EventType>(["status_update", "follow_up", "user_reply"]);
const STAGE_BEARING = new Set<EventType>(["applied", "recruiter_outreach", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"]);

const specific = (role: string | null | undefined) => !!role && !isRoleFragment(role) && roleCore(role).length > 0;
function groupCycle(g: Group): Cycle {
  const years = new Set<number>(), seasons = new Set<string>();
  for (const e of g.events) { const c = cycleOf(e.role); c.years.forEach((y) => years.add(y)); c.seasons.forEach((s) => seasons.add(s)); }
  return { years: [...years].sort(), seasons: [...seasons].sort() };
}
const lastAt = (g: Group) => g.events[g.events.length - 1].occurredAt.getTime();
const endedByEmployerOrUser = (g: Group) => { const last = [...g.events].reverse().find((e) => STAGE_BEARING.has(e.type)); return last?.type === "rejection" || last?.type === "withdrawn"; };

/**
 * An externship is not an internship even when the event says only "Internship". A stated role whose program markers differ from the group's conflicts; a role that
 * states no program conflicts only when it names the default one ("intern"/"internship") against a group that is a named program, or the reverse.
 */
function programConflictWithGroup(g: Group, e: EffectiveEvent): boolean {
  if (!e.role || isRoleFragment(e.role)) return false;
  const gp = new Set(g.events.flatMap((x) => (x.role && !isRoleFragment(x.role) ? programsOf(x.role) : [])));
  const ep = programsOf(e.role);
  const names = (r: string) => /\bintern(?:ship)?s?\b/i.test(r);
  if (ep.length > 0 && gp.size > 0) return !ep.some((p) => gp.has(p));
  if (ep.length === 0 && gp.size > 0) return names(e.role);
  if (ep.length > 0 && gp.size === 0) return g.events.some((x) => x.role && !isRoleFragment(x.role) && names(x.role));
  return false;
}

type Relation = "match" | "generic" | "conflict";
/** How an event relates to an established opportunity, from role, cycle and program alone (time and thread are weighed by the caller). */
function relation(g: Group, e: EffectiveEvent): Relation {
  const ec = cycleOf(e.role);
  if (cyclesConflict(groupCycle(g), ec)) return "conflict";
  if (programConflictWithGroup(g, e)) return "conflict";
  if (!specific(e.role)) return "generic";
  const roles = g.events.map((x) => x.role).filter((r): r is string => specific(r));
  if (roles.length === 0) return "generic";
  const ok = roles.some((r) => roleRelationV2(r, e.role) === "match" && !programsConflict(r, e.role) && !cyclesConflict(cycleOf(r), ec));
  return ok ? "match" : "conflict";
}

function allowed(g: Group, e: EffectiveEvent, rel: Relation, viaThread: boolean): boolean {
  if (rel === "conflict") return false;
  if (endedByEmployerOrUser(g) && !NEUTRAL.has(e.type)) return false; // a new application after a rejection is a new opportunity
  const gap = e.occurredAt.getTime() - lastAt(g);
  if (rel === "generic") return gap <= (viaThread ? GENERIC_WINDOW_WITH_THREAD : GENERIC_WINDOW);
  if (viaThread) return true;
  const gc = groupCycle(g), ec = cycleOf(e.role);
  const positiveCycle = gc.years.length > 0 && ec.years.length > 0; // already known not to conflict, so they share a year
  return positiveCycle || gap <= SPECIFIC_WINDOW_NO_CYCLE;
}

export function groupEventsLegacyV2(events: EffectiveEvent[]): Group[] {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  // a person's "belongs with" constraints form components; an event in a component whose group exists joins it directly
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; return p === x ? x : (parent.set(x, find(p)), parent.get(x)!); };
  const ids = new Set(sorted.map((e) => e.id));
  for (const e of sorted) if (e.linkedTo && e.linkedTo !== e.id && ids.has(e.linkedTo)) parent.set(find(e.id), find(e.linkedTo));
  const componentGroup = new Map<string, Group>();

  const groups: Group[] = [];
  const byThread = new Map<string, Group>();
  for (const e of sorted) {
    let target: Group | undefined = parent.has(e.id) || [...parent.values()].includes(e.id) ? componentGroup.get(find(e.id)) : undefined;
    if (!target && !e.separate) {
      const tg = byThread.get(e.gmailThreadId);
      if (tg && (e.company ? tg.company && companyKey(tg.company) === companyKey(e.company) : true) && allowed(tg, e, relation(tg, e), true)) target = tg;
      if (!target) {
        if (e.company) {
          const ck = companyKey(e.company);
          const candidates = groups.filter((g) => g.company && companyKey(g.company) === ck);
          const scored = candidates.map((g) => ({ g, rel: relation(g, e) })).filter(({ g, rel }) => allowed(g, e, rel, false));
          target = scored.filter((s) => s.rel === "match").sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g ?? scored.filter((s) => s.rel === "generic").sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g;
        } else if (e.senderDomain) {
          target = groups.find((g) => !g.company && g.events.some((x) => x.senderDomain === e.senderDomain));
          // An event whose employer is unknown, from an employer's own domain that exactly ONE existing opportunity has written from, belongs with it unless
          // role, cycle, program or the end of that opportunity say otherwise (the same weighing as any other link). Platforms, freemail and several candidates never link this way.
          if (!target && classifySender(e.senderDomain) === "employer") {
            const same = groups.filter((g) => g.events.some((x) => x.senderDomain === e.senderDomain));
            if (same.length === 1 && allowed(same[0], e, relation(same[0], e), false)) target = same[0];
          }
        }
      }
    }
    if (!target) { target = { company: e.company, events: [], threads: new Set() }; groups.push(target); }
    target.events.push(e);
    target.threads.add(e.gmailThreadId);
    byThread.set(e.gmailThreadId, target);
    componentGroup.set(find(e.id), target);
    if (!target.company && e.company) target.company = e.company;
  }
  return groups;
}

/**
 * The title an opportunity shows: the latest SPECIFIC role stated with reasonable confidence, not the first one ever seen. Fragments of prose are never a title.
 * A role the person corrected always wins.
 */
function groupRole(g: Group): string | null {
  const chrono = g.events;
  const corrected = [...chrono].reverse().find((e) => e.corrected && e.role);
  if (corrected) return corrected.role;
  const byConfidence = (min: number) => [...chrono].reverse().find((e) => specific(e.role) && (e.fieldConfidence?.role ?? 0.6) >= min);
  return byConfidence(0.5)?.role ?? byConfidence(0)?.role ?? [...chrono].reverse().find((e) => e.role && !isRoleFragment(e.role))?.role ?? null;
}
export type LegacyV2Group = Group;
