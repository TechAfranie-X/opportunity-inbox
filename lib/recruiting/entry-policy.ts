import { NEAR_MISS, NEAR_MISS_WEAK } from "../reliability/flags.ts";
import type { EffectiveEvent, Opportunity } from "./types.ts";

/**
 * Entry policy: an application is created by EVIDENCE, and continued by attribution.
 *
 * Verified against the real mailbox (read-only, message by message): of the opportunities that existed only because the local model said so, almost none were the student's own application: job
 * alerts, event and webinar registrations, email verifications, marketing from tools the student uses, and a person's reply. The rule reader's applications were about 90% genuine. So a model-only
 * reading may CONTINUE an application that has real evidence (it is attributed to it by thread, role and employer, exactly as before), but it may not CREATE one. An opportunity made only of
 * unconfirmed, uncorroborated model-only events does not enter the pipeline (a model-found application IS corroborated when the message itself states the student's own application and is not marketing: signal `entry:corroborated`): its events wait, collapsed, as "possible" (one click, "Looks right", brings them in; the person's word always wins).
 * Nothing is deleted or rewritten; this is a view over stored events. `build` is the grouping function.
 */
const modelOnly = (e: EffectiveEvent) => e.signals.includes("semantic:event") && !e.signals.includes("entry:corroborated") && !e.corrected && !e.confirmed;
export const ENTRY_REASON = "possible: this looks like it could be one of your applications, but nothing in your mail confirms it (no application receipt or reply). Is it?";

export function applyEntryPolicy(events: EffectiveEvent[], build: (events: EffectiveEvent[]) => Opportunity[]): { kept: EffectiveEvent[]; demoted: EffectiveEvent[] } {
  const first = build(events);
  const drop = new Set<string>(), demoted: EffectiveEvent[] = [];
  for (const o of first) {
    const inbound = o.events.filter((e) => !e.outbound);
    // (a) built only from uncorroborated model readings, or (b) one message that names no employer at all: neither is evidence of an application the person made (all six such cases checked against the real mailbox were junk)
    const noEmployer = o.company === "Unknown company" && inbound.length === 1 && !inbound[0].corrected && !inbound[0].confirmed;
    if (inbound.length === 0 || !(inbound.every(modelOnly) || noEmployer)) continue;
    for (const e of o.events) drop.add(e.id);
    for (const e of inbound) demoted.push({ ...e, signals: [...e.signals, NEAR_MISS, NEAR_MISS_WEAK, "entry:uncorroborated"], reviewReasons: [ENTRY_REASON] });
  }
  return { kept: events.filter((e) => !drop.has(e.id)), demoted };
}

/**
 * A model-only claim of an OFFER or an ENDING with no evidence for that specific claim does not stand as one. Stored events from before the decision engine carry no decision signal; those typed
 * offer / rejection / withdrawn by the model alone (not corroborated, not confirmed, not corrected) are shown as an ordinary update and keep a signal naming the unverified claim. Events the engine
 * decided carry a `decision:` signal and are left alone (the engine already weighs them).
 */
export function retypeUnverifiedClaims(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => (e.signals.includes("semantic:event") && !e.signals.some((s) => s.startsWith("decision:")) && !e.signals.includes("entry:corroborated") && !e.corrected && !e.confirmed && ["offer", "rejection", "withdrawn"].includes(e.type) && !e.outbound
    ? { ...e, type: "status_update" as const, signals: [...e.signals, `claim:unverified:${e.type}`] } : e));
}
