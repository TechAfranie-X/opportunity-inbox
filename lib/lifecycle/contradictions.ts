import { cycleOf } from "./cycle.ts";
import type { EffectiveEvent } from "../recruiting/types.ts";

/**
 * Contradictions: competing evidence inside ONE opportunity that no rule should silently settle. The reducer still produces a state (the latest credible
 * evidence wins), but the person is told the record disagrees with itself, because a wrong guess here hides a missed chance or an accepted offer.
 * Only the employer's or the person's own words count (outbound replies are the person's); a person's confirmation settles the item.
 *  - reopened: a rejection or withdrawal followed by progress (an assessment, interview or offer)
 *  - ambiguous_identity: a message that names no role at an employer with several live applications; it was kept apart rather than guessed
 *  - offer_ended: an offer followed by a rejection or withdrawal (rescinded, declined, or a mistake)
 */
export type Contradiction = { kind: "reopened" | "offer_ended" | "ambiguous_identity" | "mixed_cycles"; eventIds: string[]; text: string };

const PROGRESS = new Set(["assessment", "interview_invite", "interview_scheduled", "offer"]);
const ENDING = new Set(["rejection", "withdrawn"]);

export function detectContradictions(events: EffectiveEvent[]): Contradiction[] {
  const out: Contradiction[] = [];
  const credible = events.filter((e) => !e.outbound || e.type === "withdrawn");
  let lastEnd: EffectiveEvent | null = null;
  let lastOffer: EffectiveEvent | null = null;
  for (const e of credible) {
    if (e.corrected || e.confirmed) { if (ENDING.has(e.type)) lastEnd = e; continue; }
    if (e.signals.includes("retraction (fact)") && lastEnd) {
      out.push({ kind: "reopened", eventIds: [lastEnd.id, e.id], text: "A rejection or withdrawal was taken back by a later message. Check where the process stands." });
      lastEnd = null;
      continue;
    }
    if (ENDING.has(e.type)) {
      // an ending the message itself STATES (the employer's own words, an acknowledged withdrawal, the programme removing the person) settles what happened: nothing to check
      const stated = e.signals.some((x) => x === "ending:own" || x === "withdrawal:ack" || x === "program:removed" || x === "closure (fact)");
      if (lastOffer && !lastEnd && !stated) out.push({ kind: "offer_ended", eventIds: [lastOffer.id, e.id], text: "An offer was followed by a message that ends the process. Check what happened." });
      lastEnd = e;
    } else if (PROGRESS.has(e.type) && lastEnd) {
      out.push({ kind: "reopened", eventIds: [lastEnd.id, e.id], text: "A rejection or withdrawal was followed by new progress. Check whether the process was reopened or this is a different application." });
      lastEnd = null;
    }
    if (e.type === "offer") lastOffer = e;
  }
  for (const e of events) if (e.signals.includes("identity:ambiguous") && !e.corrected && !e.confirmed) out.push({ kind: "ambiguous_identity", eventIds: [e.id], text: "We could not tell which of your applications to this employer this message is about. Check where it belongs." });
  // Messages of one application that state two different recruiting YEARS ("Summer 2026" and "Summer 2027"): either two applications were merged or one process spans cycles. Never silent.
  const years = new Set<number>();
  // a role that names a year RANGE ("2026-2027 AI Program", "2026-27 Fellowship") is one programme year, not two cycles
  const YEAR_RANGE = /\b20\d\d\s*[-–/]\s*(?:20)?\d\d\b/;
  for (const e of events) if (!e.outbound && !e.signals.includes("identity:reattached") && !YEAR_RANGE.test(e.role ?? "")) for (const y of cycleOf(e.role).years) years.add(y);
  if (years.size > 1) out.push({ kind: "mixed_cycles", eventIds: [events[events.length - 1].id], text: `This application's messages mention more than one recruiting cycle (${[...years].sort().join(" and ")}). Check whether they are one application or two.` });
  return out;
}
