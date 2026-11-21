import { cyclesConflict, cycleOf, type Cycle } from "../lifecycle/cycle.ts";
import { employerAlias, groupRole, relation, type Group, type IdentityContext } from "../lifecycle/identity.ts";
import { requisitionOf } from "../identity/represented-employer.ts";
import { companyKey } from "../recruiting/company.ts";
import type { ActionItem, EffectiveEvent, Opportunity } from "../recruiting/types.ts";

/**
 * "One email -> complete journey". Given ONE message, retrieve the historical evidence around it (same employer or alias, same Gmail thread, same requisition, vendor relations, the programme and role it
 * names), identify the candidate applications, compare them on role, recruiting cycle, requisition, programme, thread, sender and CHRONOLOGY, and reconstruct the chosen application's timeline, state and next
 * action. Stored evidence first; messages retrieved from Gmail on demand (lib/investigate/retrieve.ts) join as extra, unstored evidence. It decides only with a stated margin and otherwise says what is
 * still unresolved. Pure: reads stored fields and signals, never message text; the seed's own named role / cycle come from stamped facts.
 */
export type Candidate = { key: string; company: string; role: string | null; score: number; reasons: string[]; vetoes: string[]; /** Score without the product's own grouping as a prior. */ evidence: number; /** Independent, hard evidence kinds (same Gmail thread, same requisition, the message names this role). */ hard: string[] };
export type TimelineItem = { id8: string; date: string; type: string; stored: boolean };
export type Journey = {
  seed: { id8: string; date: string; type: string; company: string | null };
  retrieved: { employer: number; thread: number; requisition: number; vendor: number; gmailExtra: number };
  candidates: Candidate[];
  decision: "resolved" | "ambiguous" | "no-candidate";
  /** The seed's stored home differs from the investigated choice (a misplacement the investigation would correct). */
  misplaced: boolean;
  application: { key: string; company: string; role: string | null; cycle: string | null; requisition: string | null } | null;
  timeline: TimelineItem[];
  state: { status: string; stage: string; outcome: string | null; closedBy: string | null } | null;
  nextAction: { kind: string; title: string; due: string | null; evidence: string[] } | null;
  questions: string[];
};

const DAY = 86_400_000;
const MARGIN = 2;
const reqOf = (e: EffectiveEvent) => e.signals.find((s) => s.startsWith("req:"))?.slice(4) ?? (e.subject ? requisitionOf(e.subject) : null);
const namedRole = (e: EffectiveEvent) => e.signals.find((s) => s.startsWith("role:named:"))?.slice(11) ?? null;
const id8 = (e: { gmailMessageId: string }) => e.gmailMessageId.slice(0, 8);
const asGroup = (o: Opportunity, extra: EffectiveEvent[] = []): Group => { const events = [...o.events, ...extra].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()); return { company: o.company, events, threads: new Set(events.map((e) => e.gmailThreadId)) }; };
const cycleLabel = (c: Cycle) => (c.years.length ? `${c.seasons.join("/")} ${c.years.join("/")}`.trim() : null);
const ENDING = new Set(["rejection", "withdrawn"]);

export type JourneyInput = { opportunities: Opportunity[]; possible?: EffectiveEvent[]; actions?: ActionItem[]; ctx?: IdentityContext; extraEvents?: EffectiveEvent[] };

export function reconstructJourney(seedMessageId: string, input: JourneyInput): Journey | null {
  const { opportunities, possible = [], actions = [], ctx, extraEvents = [] } = input;
  const all = [...opportunities.flatMap((o) => o.events.map((e) => ({ e, o }))), ...possible.map((e) => ({ e, o: null as Opportunity | null })), ...extraEvents.map((e) => ({ e, o: null as Opportunity | null }))];
  const hit = all.find((x) => x.e.gmailMessageId.startsWith(seedMessageId) && !x.e.outbound);
  if (!hit) return null;
  const seed = hit.e, home = hit.o;
  const seedReq = reqOf(seed), seedNamed = namedRole(seed);
  const seedRole = seedNamed ?? seed.role;
  const seedCycle: Cycle = cycleOf(seedNamed ?? seed.role ?? seed.subject);

  // 1. retrieval: related stored evidence
  const related = all.filter(({ e }) => e !== seed && !e.outbound);
  const byEmployer = related.filter(({ e }) => e.company && seed.company && (companyKey(e.company) === companyKey(seed.company) || employerAlias(e.company, seed.company)));
  const byThread = related.filter(({ e }) => e.gmailThreadId === seed.gmailThreadId);
  const byReq = seedReq ? related.filter(({ e }) => reqOf(e) === seedReq) : [];
  const vendor = related.filter(({ e }) => e.signals.some((s) => s.startsWith("relation:vendor_for:")) && e.company && seed.company && companyKey(e.company) === companyKey(seed.company));
  const candKeys = new Map<string, Opportunity>();
  for (const x of [...byEmployer, ...byThread, ...byReq, ...vendor]) if (x.o) candKeys.set(x.o.key, x.o);
  if (home) candKeys.set(home.key, home);

  // 2. candidate comparison
  const candidates: Candidate[] = [];
  for (const o of candKeys.values()) {
    const g = asGroup(o, extraEvents.filter((x) => x.gmailThreadId === seed.gmailThreadId || (x.company && companyKey(x.company) === companyKey(o.company))));
    const reasons: string[] = [], vetoes: string[] = []; let score = 0;
    const gm = g.events.filter((e) => e !== seed);
    if (gm.length === 0) { candidates.push({ key: o.key, company: o.company, role: o.role, score: 0.5 + (o === home ? 1.5 : 0), reasons: ["no other message in this application", ...(o === home ? ["currently grouped here"] : [])], vetoes: [], evidence: 0.5, hard: [] }); continue; }
    if (seed.company && companyKey(o.company) === companyKey(seed.company)) { score += 1; reasons.push("same employer"); } else if (seed.company && employerAlias(o.company, seed.company)) { score += 0.5; reasons.push("employer name is a form of the same name"); }
    if (gm.some((e) => e.gmailThreadId === seed.gmailThreadId)) { score += 2; reasons.push("same Gmail thread"); }
    const oReqs = new Set(gm.map(reqOf).filter((x): x is string => !!x));
    if (seedReq && oReqs.size > 0) { if (oReqs.has(seedReq)) { score += 3; reasons.push("same requisition"); } else vetoes.push("a different requisition"); }
    const gr = groupRole(g);
    if (seedRole && gr) {
      const rel = relation({ ...g, events: g.events.filter((e) => e !== seed) }, { ...seed, role: seedRole }, ctx, gm.some((e) => e.gmailThreadId === seed.gmailThreadId));
      if (rel === "match") { score += 2; reasons.push(seedNamed ? "the message names this role" : "same role"); }
      else if (rel === "conflict" && o !== home) vetoes.push("a different role, cycle or programme"); // the product's own grouping already accepted the seed here: only a different application can be vetoed by role/cycle/programme
    }
    const oc = cycleOf(gr);
    if (seedCycle.years.length && oc.years.length && cyclesConflict(oc, seedCycle) && o !== home) vetoes.push(`recruiting cycle ${cycleLabel(oc)} vs ${cycleLabel(seedCycle)}`);
    else if (seedCycle.years.length && oc.years.length) { score += 1; reasons.push("same recruiting cycle"); }
    // chronology: the seed cannot precede the application it continues, and cannot continue one that ended before it (unless the ending is retracted)
    const first = g.events.find((e) => e !== seed);
    const ended = [...gm].reverse().find((e) => ENDING.has(e.type) && e.occurredAt.getTime() < seed.occurredAt.getTime() && !e.signals.includes("terminal:proposed"));
    if (o !== home && first && first.occurredAt.getTime() > seed.occurredAt.getTime() + 2 * DAY && seed.type !== "applied") vetoes.push("the seed precedes this application's first message");
    if (o !== home && ended && ["assessment", "interview_invite", "interview_scheduled", "offer", "applied"].includes(seed.type) && !gm.some((e) => e.gmailThreadId === seed.gmailThreadId)) vetoes.push("this application had already ended before the message");
    // one receipt is sent per application: a receipt cannot continue an application that already has its own receipt from another thread (unless the same requisition ties them)
    if (o !== home && seed.type === "applied" && !seed.signals.includes("semantic:event") && gm.some((e) => e.type === "applied" && !e.signals.includes("semantic:event") && e.gmailThreadId !== seed.gmailThreadId && !(seedReq && reqOf(e) === seedReq))) vetoes.push("this application already has its own receipt");
    const near = gm.some((e) => Math.abs(e.occurredAt.getTime() - seed.occurredAt.getTime()) <= 21 * DAY);
    if (near) { score += 0.5; reasons.push("close in time"); }
    if (gm.some((e) => e.senderDomain === seed.senderDomain && e.senderName === seed.senderName)) { score += 1; reasons.push("same sender"); }
    // the product's own grouping already weighed the evidence: it is a prior, not a verdict (a margin of evidence elsewhere still wins)
    if (o === home) { score += 1.5 + (gm.some((e) => e.gmailThreadId === seed.gmailThreadId) || gm.length >= 3 ? 1.5 : 0); reasons.push("currently grouped here"); }
    const hard = reasons.filter((r) => r === "same Gmail thread" || r === "same requisition" || r === "the message names this role");
    candidates.push({ key: o.key, company: o.company, role: o.role, score: vetoes.length ? score - 10 : score, reasons, vetoes, evidence: o === home ? score - 1.5 - (gm.some((e) => e.gmailThreadId === seed.gmailThreadId) || gm.length >= 3 ? 1.5 : 0) : score, hard });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0], second = candidates[1];
  // the product's own grouping stands unless the evidence clearly favours another application; a small lead for the incumbent over an equally plausible sibling is "the grouping stands", not a new decision
  const incumbentBest = !!best && !!home && best.key === home.key && best.vetoes.length === 0;
  const chosen = best && best.vetoes.length === 0 && (!second || best.score - second.score >= MARGIN || second.vetoes.length > 0 || incumbentBest) ? best : null;
  const decision: Journey["decision"] = candidates.length === 0 ? "no-candidate" : chosen ? "resolved" : "ambiguous";
  const opp = chosen ? candKeys.get(chosen.key)! : null;
  const questions: string[] = [];
  if (decision === "ambiguous") questions.push(`Which application is this message about: ${candidates.filter((c) => c.vetoes.length === 0).slice(0, 3).map((c) => `${c.company} ${c.role ?? "(no role)"}`).join(" / ") || "no candidate survives the checks"}?`);
  if (decision === "no-candidate") questions.push("No application at this employer was found for this message.");

  // 3. the chosen application's timeline and state
  const extraIds = new Set(extraEvents.map((e) => e.id));
  const events = opp ? [...opp.events, ...(opp.events.includes(seed) ? [] : [seed]), ...extraEvents.filter((x) => (x.gmailThreadId === seed.gmailThreadId || (x.company && companyKey(x.company) === companyKey(opp.company))) && !opp.events.includes(x))].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()) : [];
  const timeline: TimelineItem[] = events.filter((e) => !e.outbound).map((e) => ({ id8: id8(e), date: e.occurredAt.toISOString().slice(0, 10), type: e.type, stored: !extraIds.has(e.id) }));
  const req = events.map(reqOf).find((x) => !!x) ?? null;
  const act = opp ? actions.filter((a) => a.opportunityKey === opp.key).sort((a, b) => b.priority - a.priority)[0] : undefined;
  const actEvidence = act ? events.filter((e) => (act.sourceThreadId && e.gmailThreadId === act.sourceThreadId) || (act.due && e.eventDate && Math.abs(e.eventDate.getTime() - act.due.getTime()) < DAY)).map(id8) : [];
  return {
    seed: { id8: id8(seed), date: seed.occurredAt.toISOString().slice(0, 10), type: seed.type, company: seed.company },
    retrieved: { employer: byEmployer.length, thread: byThread.length, requisition: byReq.length, vendor: vendor.length, gmailExtra: extraEvents.length },
    candidates, decision,
    misplaced: !!(chosen && home && chosen.key !== home.key),
    application: opp ? { key: opp.key, company: opp.company, role: opp.role, cycle: cycleLabel(cycleOf(groupRole(asGroup(opp)))), requisition: req } : null,
    timeline,
    state: opp ? { status: opp.status, stage: opp.stage, outcome: opp.outcome ?? null, closedBy: opp.closedBy ?? null } : null,
    nextAction: act ? { kind: act.kind, title: act.title, due: act.due ? act.due.toISOString().slice(0, 10) : null, evidence: actEvidence } : null,
    questions,
  };
}
