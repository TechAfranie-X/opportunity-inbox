import { buildActions } from "./actions.ts";
import { buildOpportunities } from "./opportunity.ts";
import type { EffectiveEvent, ExtractedEvent } from "./types.ts";

/**
 * What the product would conclude from a set of predicted events: how it groups them into opportunities and which
 * threads it would put in front of the user today. The evaluator scores these against human labels.
 * `asOf` is a floating date (its UTC fields are the wall clock), matching how the product treats "now".
 */
export function deriveProduct(events: ExtractedEvent[], asOf: Date) {
  const effective: EffectiveEvent[] = events.map((e, i) => ({ ...e, id: `${e.gmailMessageId}#${i}`, corrected: false }));
  const opportunities = buildOpportunities(effective);
  const groups = new Map<string, string>();
  for (const o of opportunities) for (const e of o.events) groups.set(e.gmailMessageId, o.key);
  const todayThreads = new Set<string>();
  for (const a of buildActions(opportunities, asOf, new Set())) {
    if ((a.bucket === "overdue" || a.bucket === "today") && a.sourceThreadId) todayThreads.add(a.sourceThreadId);
  }
  return { groups, todayThreads };
}
