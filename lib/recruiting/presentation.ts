import { PULSE_STAGES, journeyPosition } from "./history.ts";
import { stageOfEvent } from "./opportunity.ts";
import type { EffectiveEvent, Opportunity, Stage } from "./types.ts";

/**
 * How much we know about WHO an opportunity is with, so the product can say so instead of treating a strong suggestion and a blank alike.
 *   known   - a person confirmed or corrected it, or the evidence is strong
 *   likely  - we have a grounded name but the evidence is weak: shown, and marked as needing confirmation
 *   unknown - we have no name at all
 * Nothing here invents a name: it only describes the confidence in the one the reader found.
 */
export type EntityState = "known" | "likely" | "unknown";
const KNOWN_AT = 0.6;

export function entityState(opportunity: Pick<Opportunity, "company" | "events">): EntityState {
  if (!opportunity.company) return "unknown";
  const named = opportunity.events.filter((e) => e.company);
  if (named.some((e) => e.corrected || e.confirmed)) return "known";
  const best = Math.max(0, ...named.map((e) => e.fieldConfidence?.company ?? e.confidence));
  return best >= KNOWN_AT ? "known" : "likely";
}

/** Up to two letters for a monogram. Deterministic; never a guess at a logo. */
export function monogram(name: string | null): string {
  const words = (name ?? "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export type Milestone = { stage: Stage; at: Date | null; reached: boolean; current: boolean };

/** The stages of one opportunity with the day each was first reached: "how I got here". A stage that was skipped is reached with no date. */
export function stageMilestones(opportunity: Pick<Opportunity, "events" | "stage" | "status">): Milestone[] {
  const firstAt = new Map<Stage, Date>();
  for (const e of opportunity.events as EffectiveEvent[]) {
    const s = stageOfEvent(e.type);
    if (s && s !== "closed" && !firstAt.has(s)) firstAt.set(s, e.occurredAt);
  }
  const highestSeen = Math.max(-1, ...[...firstAt.keys()].map((s) => PULSE_STAGES.indexOf(s)));
  const idx = opportunity.stage === "closed" ? highestSeen : journeyPosition(opportunity.stage).index;
  return PULSE_STAGES.map((stage, i) => ({ stage, at: firstAt.get(stage) ?? null, reached: i <= idx, current: opportunity.status === "active" && i === idx }));
}
