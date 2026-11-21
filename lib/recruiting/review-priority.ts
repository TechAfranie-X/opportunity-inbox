import type { ReviewItem } from "./review.ts";
import type { Opportunity } from "./types.ts";

/**
 * Which questions are worth the student's attention. The question is not "is the system unsure?" but "could the answer change what the student does next?".
 *
 *   decide   a question whose answer can change a decision: an ending proposed for an application with something pending (an upcoming dated step or an open offer); competing evidence on a live
 *            application; a message that could close, advance or settle one of several live applications and cannot be attributed; a confirmation that a later reading contradicts;
 *            a possible missed opportunity of a consequential kind.
 *   suggest  everything else: an optional identity suggestion, a proposed ending on an application that is only at the receipt stage, a type or company doubt on a routine message. Shown
 *            collapsed, never counted, never urgent.
 * Repetition is collapsed (the same question about the same application is one question), and a doubt the evidence has already settled is not asked at all.
 * Pure. Uses stored fields only, never message text.
 */
const CONSEQUENTIAL = new Set(["rejection", "withdrawn", "offer", "interview_invite", "interview_scheduled", "assessment"]);
const DATED = new Set(["interview_scheduled", "interview_invite", "assessment", "offer"]);
const DAY = 86_400_000;
/** Something is actually PENDING on the application: a dated step that has not passed (an interview, an assessment deadline, an offer deadline) or an open offer. Stage alone does not make it live. */
export const pending = (o: Opportunity | undefined, now: Date): boolean => !!o && o.status === "active" && (o.outcome === "offer" || o.events.some((e) => !e.outbound && DATED.has(e.type) && !!e.eventDate && e.eventDate.getTime() >= now.getTime() - DAY));
export type Priority = "decide" | "suggest";

export function priorityOf(item: ReviewItem, opp: Opportunity | undefined, now: Date = new Date()): Priority {
  const e = item.event, active = !!opp && opp.status === "active", live = pending(opp, now), consequential = CONSEQUENTIAL.has(e.type);
  switch (item.kind) {
    case "confirmation-conflict": return "decide";
    case "contradiction": return active ? "decide" : "suggest";
    case "ambiguous": return consequential ? "decide" : "suggest";
    case "proposed-ending": return live ? "decide" : "suggest";
    case "possible": return consequential && !item.weak ? "decide" : "suggest";
    case "suggestion": return consequential ? "decide" : "suggest";
    default: return consequential && live ? "decide" : "suggest";
  }
}

/** A doubt the evidence already settled is not a question. */
const settled = (item: ReviewItem): boolean => item.kind === "doubt" && item.event.signals.includes("decision:verified") && !item.reasons.some((r) => /goodbye|say no|second reader/i.test(r));

export function prioritize(items: ReviewItem[], opportunities: Opportunity[], now: Date = new Date()): ReviewItem[] {
  const byKey = new Map(opportunities.map((o) => [o.key, o] as const));
  const seen = new Map<string, ReviewItem>();
  const out: ReviewItem[] = [];
  for (const it of items) {
    if (settled(it)) continue;
    const priority = priorityOf(it, byKey.get(it.opportunityKey), now);
    const next: ReviewItem = { ...it, tier: priority === "decide" ? "important" : "routine", ...(priority === "suggest" ? { suggestion: true } : {}) };
    const sig = `${it.opportunityKey}|${it.kind ?? "doubt"}|${it.reasons[0] ?? ""}`;
    const prior = seen.get(sig);
    if (prior && it.opportunityKey) { prior.similar = (prior.similar ?? 0) + 1; continue; } // the same question about the same application is one question
    seen.set(sig, next);
    out.push(next);
  }
  return out;
}
