import type { EffectiveEvent } from "./types.ts";

/**
 * Disposition: where a message ended up and WHY. A classified message is not a resolved one: every inbound message the product holds is either part of a journey (a job application or a programme) or in
 * the possible list with one of these explicit dispositions. "violation" marks a message whose own facts say it belongs in a journey (an own-application receipt, an ending, a programme acceptance or
 * evidence) yet it waits outside one: the cycle's contract is that there are none.
 */
export type Disposition =
  | { kind: "journey"; lane: "job" | "program" }
  | { kind: "prospecting"; why: string }
  | { kind: "noise"; why: string }
  | { kind: "review"; why: string }
  | { kind: "violation"; why: string };

const has = (e: EffectiveEvent, s: string) => e.signals.includes(s);
const classOf = (e: EffectiveEvent) => e.signals.find((x) => x.startsWith("class:"))?.slice(6);

/** The disposition of a message that is NOT in a journey (an event of the possible list). */
export function disposeOutside(e: EffectiveEvent): Disposition {
  const c = classOf(e);
  if (c === "program-acceptance") return { kind: "violation", why: "a programme acceptance is a programme journey, not an outside message" };
  if (e.signals.some((x) => x.startsWith("program:evidence:"))) return { kind: "violation", why: "programme evidence belongs to its programme's journey" };
  const known = !!e.company && !/^unknown/i.test(e.company);
  if (known && !c && (has(e, "own:receipt") || has(e, "ending:own") || has(e, "withdrawal:ack"))) return { kind: "violation", why: "the message states the reader's own application or its ending" };
  if (c === "marketing") return { kind: "prospecting", why: "mass-mailing campaign with a call to apply" };
  if (c === "notice") return { kind: "prospecting", why: "platform notice (recommendation, contact request)" };
  if (c === "event" || c === "survey" || c === "community") return { kind: "noise", why: `${c} message with no programme journey to join` };
  if (c === "admin" || c === "logistics") return { kind: "noise", why: `${c} message with no application to attach to` };
  return { kind: "review", why: "no class and no own-process fact: genuinely unclear" };
}
