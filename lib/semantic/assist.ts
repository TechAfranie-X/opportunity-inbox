import { candidateEvent } from "../reliability/assess.ts";
import { NEAR_MISS, NEAR_MISS_WEAK, isNearMiss, isWeakNearMiss } from "../reliability/flags.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import type { EventType, ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { SECOND_READER_NO, SECOND_READER_YES } from "./consensus.ts";
import { usable } from "./port.ts";

/**
 * Assist mode: the language model's verified opinion changes what the product SHOWS, not just what it asks. It is a second reader with real authority in
 * exactly four places, each guarded by the deterministic verifier (an opinion reaches here only if its evidence quote was found in the message):
 *
 *   rules found nothing, model high certainty yes   -> a pipeline event of the model's type (signal "semantic:event"); the refinement gates still apply
 *   rules found nothing, model medium certainty yes -> a counted "possibly recruiting" item (a person decides)
 *   near miss, model says no                        -> excluded from review ("semantic:excluded"): the model read it and it is not recruiting
 *   near miss, model says yes                       -> weak: counted; high certainty: promoted to a pipeline event
 *   rules event typed only "status_update", model high certainty with a specific type -> the type is made specific ("semantic:type")
 * Everything else is as in consensus.ts (doubt on disagreement, no effect on agreement). Dates, employer and role come from deterministic code and from
 * the verified reading (lib/semantic/employer.ts), never from this function. The message itself is never stored or altered.
 */
export const SEMANTIC_EVENT = "semantic:event";
export const SEMANTIC_EXCLUDED = "semantic:excluded";
export const isSemanticExcluded = (e: { signals: string[] }) => e.signals.includes(SEMANTIC_EXCLUDED);

const UNREADABLE = /could not read/;
const asEventType = (t: string | null): EventType => (t === "withdrawn" ? "withdrawn" : ((t ?? "status_update") as EventType));

function semanticEvent(m: RecruitingEmail, op: VerifiedOutput): ExtractedEvent {
  const base = candidateEvent(m, "strong", "", []);
  return {
    ...base,
    type: asEventType(op.type),
    confidence: 0.72,
    fieldConfidence: { type: 0.72, company: base.fieldConfidence?.company ?? 0, role: 0 },
    reviewReasons: [],
    signals: [SEMANTIC_EVENT, `semantic:certainty:${op.certainty}`],
  };
}

export function applyAssist(events: ExtractedEvent[], emails: RecruitingEmail[], opinions: Map<string, VerifiedOutput>): ExtractedEvent[] {
  if (opinions.size === 0) return events;
  const byId = new Map(emails.map((m) => [m.id, m] as const));
  const out = events.map((e) => {
    const op = opinions.get(e.gmailMessageId);
    const m = byId.get(e.gmailMessageId);
    if (!usable(op) || e.outbound || !m) return e;
    if (isNearMiss(e)) {
      if (UNREADABLE.test((e.reviewReasons ?? []).join(" "))) return e;
      if (!op.recruiting) return { ...e, signals: [...e.signals, "semantic:no", SEMANTIC_EXCLUDED] };
      if (op.certainty === "high") return { ...semanticEvent(m, op), company: e.company ?? semanticEvent(m, op).company };
      if (isWeakNearMiss(e)) return { ...e, signals: [...e.signals.filter((s) => s !== NEAR_MISS_WEAK), "semantic:yes"], reviewReasons: [SECOND_READER_YES] };
      return e;
    }
    if (!op.recruiting) return { ...e, reviewReasons: [...new Set([...(e.reviewReasons ?? []), SECOND_READER_NO])], signals: [...e.signals, "semantic:no"] };
    const generic = e.type === "status_update" && op.certainty === "high" && op.type && op.type !== "status_update";
    return { ...e, type: generic ? asEventType(op.type) : e.type, signals: [...e.signals, generic ? "semantic:type" : "semantic:agree"] };
  });
  const have = new Set(out.map((e) => e.gmailMessageId));
  const added = emails.flatMap((m) => {
    if (m.outbound || have.has(m.id)) return [];
    const op = opinions.get(m.id);
    if (!usable(op) || !op.recruiting) return [];
    return [op.certainty === "high" ? semanticEvent(m, op) : candidateEvent(m, "strong", SECOND_READER_YES, ["semantic:yes"])];
  });
  void NEAR_MISS;
  return added.length > 0 ? [...out, ...added].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()) : out;
}
