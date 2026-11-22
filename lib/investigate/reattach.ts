import { identityContext } from "../recruiting/product-config.ts";
import type { EffectiveEvent, Opportunity } from "../recruiting/types.ts";
import { reconstructJourney } from "./journey.ts";

/**
 * Bringing the investigation into the product. Grouping is greedy and chronological: a late reply in an old Gmail thread can land in an application that ended months ago, and nothing later corrects
 * it. This pass asks the investigator about exactly the events the product itself contradicts (a message that follows the ending of a closed application by more than 60 days, or one flagged as
 * ambiguous/suggested) with the event taken OUT of its application, and, when the investigation resolves it to a DIFFERENT application that clearly outscores the one it sits in, links the event there.
 * The link is an ordinary "belongs with" (`linkedTo`) so one more grouping pass places it, and Today, Pipeline and Review all show the corrected journey. A person's correction or confirmation is
 * never moved; the pass changes nothing when the investigation is not decisive. INVESTIGATE_REATTACH=off turns it off.
 */
const DAY = 86_400_000;
export type Move = { eventId: string; anchorId: string; from: string; to: string; reason: string };

export function plannedMoves(opportunities: Opportunity[]): Move[] {
  const ctx = identityContext();
  const moves: Move[] = [];
  for (const o of opportunities) {
    const ending = o.status === "closed" ? [...o.events].reverse().find((e) => (e.type === "rejection" || e.type === "withdrawn") && !e.signals.includes("terminal:proposed")) : undefined;
    const orphan = !o.role && o.status === "active" && o.events.length <= 3 && o.events.every((x) => x.outbound || ["status_update", "follow_up", "user_reply"].includes(x.type));
    for (const e of o.events) {
      if (e.outbound || e.corrected || e.confirmed || e.linkedTo || (o.events[0] === e && !orphan) || moves.some((m) => m.eventId === e.id)) continue;
      const afterEnding = !!ending && e.occurredAt.getTime() - ending.occurredAt.getTime() > 60 * DAY && e.type !== "rejection" && e.type !== "withdrawn";
      const flagged = e.signals.includes("identity:ambiguous") || e.signals.some((s) => s.startsWith("identity:suggest:"));
      if (!afterEnding && !flagged && !orphan) continue;
      // the event alone against every application
      const apart: Opportunity[] = opportunities.flatMap((x) => (x === o ? [{ ...x, events: x.events.filter((y) => y !== e) }, { ...x, key: `${x.key}~apart`, events: [e], status: "active" as const, stage: "applied" as const, outcome: null, closedBy: null }] : [x]));
      const j = reconstructJourney(e.gmailMessageId, { opportunities: apart, ctx });
      if (!j || j.decision !== "resolved" || !j.application || j.application.key === o.key || j.application.key.endsWith("~apart")) continue;
      const to = apart.find((x) => x.key === j.application!.key);
      const best = j.candidates[0], home = j.candidates.find((c) => c.key === o.key);
      if (!to || !best || best.vetoes.length > 0 || (home && best.score - home.score < (orphan && !afterEnding && !flagged ? 1 : 2))) continue;
      // the application's event nearest in time to the message, before it when there is one, else its first (a message may precede the application's first mail)
      const anchor = [...to.events].reverse().find((x) => !x.outbound && x.occurredAt.getTime() <= e.occurredAt.getTime()) ?? to.events.find((x) => !x.outbound);
      if (!anchor) continue;
      moves.push({ eventId: e.id, anchorId: anchor.id, from: o.key, to: to.key, reason: best.reasons.join(", ") });
      // the conversation unit: the same Gmail thread's other messages in the same application that follow the ending (a sent reply, a calendar message, a later reply) travel with it
      for (const sib of o.events) {
        if (sib === e || sib.corrected || sib.confirmed || sib.linkedTo || moves.some((m) => m.eventId === sib.id)) continue;
        const norm = (x: string | null) => (x ?? "").toLowerCase().replace(/^(?:\s*(?:re|fw|fwd|aw)\s*:\s*)+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
        const answers = sib.outbound && Math.abs(sib.occurredAt.getTime() - e.occurredAt.getTime()) <= 3 * DAY && norm(sib.subject).length >= 8 && (norm(e.subject).includes(norm(sib.subject)) || norm(sib.subject).includes(norm(e.subject)));
        if ((sib.gmailThreadId !== e.gmailThreadId && !answers) || (ending && sib.occurredAt.getTime() <= ending.occurredAt.getTime())) continue;
        const a = anchor;
        moves.push({ eventId: sib.id, anchorId: a.id, from: o.key, to: to.key, reason: "same conversation as a moved message" });
      }
    }
  }
  return moves;
}

/**
 * Sibling reconciliation after a terminal decision. A second employer message that only CONFIRMS an ending (a rejection, a withdrawal) of an application that has already ended, within a month, for the
 * same employer and the same named opportunity, is the same application's last word, not an application of its own. Singleton terminal fragments are attached to the ended sibling. Distinct receipts
 * (two applications) are never touched: only a lone terminal event is moved, and only onto a sibling whose own verified ending precedes it.
 */
export function terminalFragmentMoves(opportunities: Opportunity[]): Move[] {
  const norm = (x: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const moves: Move[] = [];
  for (const b of opportunities) {
    if (b.events.length !== 1 || b.status !== "closed") continue;
    const e = b.events[0];
    if ((e.type !== "rejection" && e.type !== "withdrawn") || e.outbound || e.corrected || e.confirmed || e.linkedTo || e.signals.includes("terminal:proposed")) continue;
    for (const a of opportunities) {
      if (a === b || a.status !== "closed" || a.kind !== b.kind || norm(a.company) !== norm(b.company) || norm(a.role) !== norm(b.role) || !norm(b.role)) continue;
      const ending = [...a.events].reverse().find((x) => (x.type === "rejection" || x.type === "withdrawn") && !x.signals.includes("terminal:proposed"));
      if (!ending) continue;
      const gap = e.occurredAt.getTime() - ending.occurredAt.getTime();
      const requisitions = (x: Opportunity) => new Set(x.events.map((y) => y.signals.find((q) => q.startsWith("req:"))).filter(Boolean));
      const ra = requisitions(a), rb = requisitions(b);
      if (gap < 0 || gap > 45 * DAY || (ra.size > 0 && rb.size > 0 && ![...rb].some((q) => ra.has(q)))) continue;
      const anchor = [...a.events].reverse().find((x) => !x.outbound && x.occurredAt.getTime() <= e.occurredAt.getTime());
      if (anchor) { moves.push({ eventId: e.id, anchorId: anchor.id, from: b.key, to: a.key, reason: "confirms the ending of its sibling" }); break; }
    }
  }
  return moves;
}

/**
 * Fragment consolidation. Grouping is greedy, so one application whose mail names it differently (an acronym and its spelled-out form, a role with or without its ordinal and year, a receipt from the platform
 * and a calendar message from the host) can end as several small journeys. A small journey joins another when ALL of these hold: the same kind of opportunity; the same distinctive role words once years,
 * ordinals, generic words and the employer's own name are removed (and at least two of them); the employers are not different (the same, an alias, an acronym, or one side states none / is only the role's
 * own name); no conflicting recruiting year; no two different requisitions; the two are not both separately receipted applications; and they touch within 120 days. The larger journey is the home. Whole journeys move,
 * through the same "belongs with" link, so Today, Pipeline and Review all show one journey.
 */
const STOP = new Set(["the", "a", "an", "to", "for", "of", "and", "in", "at", "on", "attend", "join", "annual", "program", "programme", "application", "summer", "intern", "internship", "role", "position", "our", "your", "my", "update"]);
const GENERIC_ROLE = new Set(["software", "engineer", "engineers", "engineering", "developer", "analyst", "data", "science", "scientist", "research", "researcher", "associate", "product", "design", "designer", "manager", "management", "business", "technology", "technical", "student", "students", "opportunity", "opportunities", "career", "careers", "job", "full", "time", "part", "new", "grad", "graduate", "undergraduate", "fall", "spring", "winter"]);
const normTokens = (x: string | null | undefined, drop: Set<string>) => new Set((x ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+(st|nd|rd|th)?$/.test(t) && !/^20\d\d$/.test(t) && !drop.has(t)));
export function fragmentMoves(opportunities: Opportunity[], alias: (a: string, b: string) => boolean): Move[] {
  const moves: Move[] = [];
  const years = (o: Opportunity) => new Set((o.role ?? "").match(/\b20\d\d\b/g) ?? []);
  const reqs = (o: Opportunity) => new Set(o.events.map((y) => y.signals.find((q) => q.startsWith("req:"))).filter(Boolean));
  // an employer that is only the role's own name ("Leadership Institute") says nothing against a merge; "Unknown company" says nothing either way and needs the exact same long role (below)
  const weak = (name: string, roleTokens: Set<string>) => !/^unknown/i.test(name) && [...normTokens(name, new Set())].every((t) => roleTokens.has(t));
  const sorted = [...opportunities].sort((a, b) => b.events.length - a.events.length || a.firstActivityAt.getTime() - b.firstActivityAt.getTime());
  // the distinctive role words: the employer's own name is removed unless nothing distinctive would be left
  const coreOf = (o: Opportunity) => { const full = normTokens(o.role, new Set()); const less = normTokens(o.role, normTokens(o.company, new Set())); return less.size >= 2 ? less : full; };
  const initials = (name: string) => (name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map((w) => w[0]).join(""));
  const acronymOf = (x: Opportunity, y: Opportunity) => { const t = [...normTokens(x.company, new Set())]; const i = initials(y.company); return i.length >= 3 && t.includes(i); };
  const taken = new Set<string>();
  for (const b of sorted) {
    // an event the person CORRECTED or CONFIRMED may be regrouped: a correction fixes the event's fields (kept as they are), not which journey it sits in. A link the person MADE (`linkedTo`) never moves.
    if (b.events.length > 8 || b.events.some((e) => e.linkedTo) || taken.has(b.key)) continue;
    const bw = coreOf(b);
    const exactRole = (o: Opportunity) => (o.role ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const bDistinct = [...bw].filter((t) => !GENERIC_ROLE.has(t)).length >= 2;
    if (!bDistinct && exactRole(b).length < 25) continue;
    for (const a of sorted) {
      if (a === b || a.events.length < b.events.length || a.kind !== b.kind || taken.has(a.key) || moves.some((m) => m.from === a.key)) continue;
      const aw = coreOf(a);
      if (([...aw].filter((t) => !GENERIC_ROLE.has(t)).length < 2 && !(exactRole(a) === exactRole(b) && exactRole(a).length >= 25)) || [...bw].some((t) => !aw.has(t)) || [...aw].some((t) => !bw.has(t))) continue;
      const [ya, yb] = [years(a), years(b)];
      if (ya.size > 0 && yb.size > 0 && ![...yb].some((y) => ya.has(y))) continue;
      const ra = reqs(a), rb = reqs(b);
      if (ra.size > 0 && rb.size > 0 && ![...rb].some((q) => ra.has(q))) continue;
      // two receipts from different Gmail threads are two applications (one receipt is sent per application): never one journey, whatever else they share
      const receipts = (o: Opportunity) => o.events.filter((e) => !e.outbound && e.type === "applied");
      if (receipts(a).length > 0 && receipts(b).length > 0 && !receipts(b).every((r) => receipts(a).some((x) => x.gmailThreadId === r.gmailThreadId))) continue;
      const roleTokens = new Set([...aw, ...bw]);
      const exactLong = exactRole(a) === exactRole(b) && exactRole(a).length >= 25;
      const employersOk = a.company === b.company || (exactLong && (/^unknown/i.test(a.company) || /^unknown/i.test(b.company))) || alias(a.company, b.company) || acronymOf(a, b) || acronymOf(b, a) || weak(a.company, roleTokens) || weak(b.company, roleTokens);
      if (!employersOk) continue;
      const gap = Math.max(0, Math.max(a.firstActivityAt.getTime(), b.firstActivityAt.getTime()) - Math.min(a.lastActivityAt.getTime(), b.lastActivityAt.getTime()));
      if (gap > 120 * DAY) continue;
      const anchor = [...a.events].reverse().find((x) => !x.outbound && x.occurredAt.getTime() <= b.events[0].occurredAt.getTime()) ?? a.events.find((x) => !x.outbound);
      if (!anchor) continue;
      for (const e of b.events) moves.push({ eventId: e.id, anchorId: anchor.id, from: b.key, to: a.key, reason: "the same journey under another name" });
      taken.add(b.key);
      break;
    }
  }
  return moves;
}

/**
 * A terminal message that names no position ("BlackRock | Application update", an unsigned rejection) is the last word of an application the student has at that employer. When exactly ONE open job
 * journey at the same employer is compatible (no conflicting requisition, no conflicting cycle, the message is later than the journey's first message, and the message's role, if it has one, matches), the
 * terminal message belongs to it: it is moved there and the reducer closes it. More than one compatible open journey, or none: nothing moves (it is never guessed, and nothing is closed by age).
 */
export function openSiblingTerminalMoves(opportunities: Opportunity[], alias: (a: string, b: string) => boolean): Move[] {
  const moves: Move[] = [];
  const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const reqs = (o: Opportunity) => new Set(o.events.map((y) => y.signals.find((q) => q.startsWith("req:"))).filter(Boolean));
  const yearsOf = (x: string | null) => new Set((x ?? "").match(/\b20\d\d\b/g) ?? []);
  for (const b of opportunities) {
    if (b.events.length !== 1 || b.status !== "closed" || (b.kind ?? "job") !== "job") continue;
    const e = b.events[0];
    if ((e.type !== "rejection" && e.type !== "withdrawn") || e.outbound || e.corrected || e.confirmed || e.linkedTo || e.signals.includes("terminal:proposed")) continue;
    const open = opportunities.filter((a) => a !== b && a.status === "active" && (a.kind ?? "job") === "job" && (key(a.company) === key(b.company) || alias(a.company, b.company))
      && a.events.some((x) => !x.outbound && x.occurredAt.getTime() <= e.occurredAt.getTime())
      && !(reqs(a).size > 0 && reqs(b).size > 0 && ![...reqs(b)].some((q) => reqs(a).has(q)))
      && (() => { const ya = yearsOf(a.role), yb = yearsOf(b.role); return !(ya.size > 0 && yb.size > 0 && ![...yb].some((y) => ya.has(y))); })()
      && (!b.role || !a.role || roleCompatible(a.role, b.role)));
    if (open.length !== 1) continue;
    const a = open[0];
    const anchor = [...a.events].reverse().find((x) => !x.outbound && x.occurredAt.getTime() <= e.occurredAt.getTime());
    if (anchor) moves.push({ eventId: e.id, anchorId: anchor.id, from: b.key, to: a.key, reason: "the one open application at this employer ends here" });
  }
  return moves;
}
const roleCompatible = (x: string, y: string) => { const t = (z: string) => new Set(z.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["intern", "internship", "summer", "the", "and", "program", "programme"].includes(w) && !/^20\d\d$/.test(w))); const A = t(x), B = t(y); if (A.size === 0 || B.size === 0) return true; const shared = [...A].filter((w) => B.has(w)).length; return shared / Math.min(A.size, B.size) >= 0.5; };

export function applyMoves(events: EffectiveEvent[], moves: Move[]): EffectiveEvent[] {
  const by = new Map(moves.map((m) => [m.eventId, m]));
  return events.map((e) => (by.has(e.id) ? { ...e, signals: [...e.signals, "identity:reattached", `identity:attach:${by.get(e.id)!.anchorId}`] } : e));
}
