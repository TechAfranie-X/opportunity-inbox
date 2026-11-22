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

export function applyMoves(events: EffectiveEvent[], moves: Move[]): EffectiveEvent[] {
  const by = new Map(moves.map((m) => [m.eventId, m]));
  return events.map((e) => (by.has(e.id) ? { ...e, signals: [...e.signals, "identity:reattached", `identity:attach:${by.get(e.id)!.anchorId}`] } : e));
}
