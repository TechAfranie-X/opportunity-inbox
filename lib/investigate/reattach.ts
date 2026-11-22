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
    for (const e of o.events) {
      if (e.outbound || e.corrected || e.confirmed || e.linkedTo || o.events[0] === e) continue;
      const afterEnding = !!ending && e.occurredAt.getTime() - ending.occurredAt.getTime() > 60 * DAY && e.type !== "rejection" && e.type !== "withdrawn";
      const flagged = e.signals.includes("identity:ambiguous") || e.signals.some((s) => s.startsWith("identity:suggest:"));
      if (!afterEnding && !flagged) continue;
      // the event alone against every application
      const apart: Opportunity[] = opportunities.flatMap((x) => (x === o ? [{ ...x, events: x.events.filter((y) => y !== e) }, { ...x, key: `${x.key}~apart`, events: [e], status: "active" as const, stage: "applied" as const, outcome: null, closedBy: null }] : [x]));
      const j = reconstructJourney(e.gmailMessageId, { opportunities: apart, ctx });
      if (!j || j.decision !== "resolved" || !j.application || j.application.key === o.key || j.application.key.endsWith("~apart")) continue;
      const to = apart.find((x) => x.key === j.application!.key);
      const best = j.candidates[0], home = j.candidates.find((c) => c.key === o.key);
      if (!to || !best || best.vetoes.length > 0 || (home && best.score - home.score < 2)) continue;
      const anchor = [...to.events].reverse().find((x) => !x.outbound && x.occurredAt.getTime() <= e.occurredAt.getTime());
      if (!anchor) continue;
      moves.push({ eventId: e.id, anchorId: anchor.id, from: o.key, to: to.key, reason: best.reasons.join(", ") });
    }
  }
  return moves;
}

export function applyMoves(events: EffectiveEvent[], moves: Move[]): EffectiveEvent[] {
  const by = new Map(moves.map((m) => [m.eventId, m]));
  return events.map((e) => (by.has(e.id) ? { ...e, linkedTo: by.get(e.id)!.anchorId, signals: [...e.signals, "identity:reattached"] } : e));
}
