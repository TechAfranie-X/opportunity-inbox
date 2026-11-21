import type { Claim, MessageLedger } from "../ledger/types.ts";
import { DECISION_CONFIG as C, DECISION_VERSION, TERMINAL_TYPES } from "./config.ts";

/**
 * The unified decision: one pure function from a message's ledger to a verdict. It never edits a claim and never discards one; the verdict names the claims it leaned on (`for`)
 * and the claims it weighed against (`against`), so every decision can be explained and replayed.
 *
 *   settled    a person decided (their correction or confirmation outweighs every automatic reading)
 *   verified   two or more independent sources support it and nothing material opposes it
 *   proposed   one source supports it and nothing material opposes it
 *   contested  material opposition: shown to a person as a question, never acted on as fact
 *   noise      the belief that this is the reader's own process is below the "possible" line
 */
export type VerdictState = "settled" | "verified" | "proposed" | "contested" | "noise";
export type Terminal = "none" | "proposed" | "verified";

export type Verdict = {
  engine: string;
  messageId: string;
  state: VerdictState;
  /** Belief that the message belongs to the reader's own recruiting process, 0..1. */
  recruiting: { belief: number; logit: number; for: string[]; against: string[] };
  /** The winning event type among the claims, with every alternative's weight. */
  type: { value: string | null; weight: number; alternatives: { value: string; weight: number }[]; for: string[]; against: string[] };
  /** For a rejection or withdrawal: whether it is a verified outcome, a proposal, or withheld. */
  terminal: Terminal;
  /** Stable machine-readable reasons, e.g. "model-only", "opposed:marketing_bulk". */
  reasons: string[];
  /** The pipeline line the belief falls on. */
  placement: "pipeline" | "possible" | "none";
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const isLowInformation = (t: string) => (C.lowInformationTypes as readonly string[]).includes(t);
const isTerminalType = (t: string | null) => !!t && (TERMINAL_TYPES as readonly string[]).includes(t);

/** Signed log-odds this claim contributes to "this is the reader's own process". 0 when it says nothing about that. */
export function recruitingWeight(c: Claim): number {
  if (c.kind === "recruiting") {
    const w = c.source === "person" ? C.personWeight : c.source === "model" ? C.modelWeight : C.ruleWeight;
    return (c.value === "yes" ? 1 : -1) * w * c.strength;
  }
  if (c.kind === "fact") return (C.recruitingFact as Record<string, number>)[c.value] ?? 0;
  return 0;
}

export function decide(l: MessageLedger): Verdict {
  // 1. is it the reader's own process?
  let logit = C.priorLogit;
  const recFor: string[] = [], recAgainst: string[] = [];
  let support = 0, opposition = 0;
  for (const c of l.claims) {
    const w = recruitingWeight(c);
    if (w === 0) continue;
    logit += w;
    if (w > 0) { support += w; recFor.push(c.id); } else { opposition -= w; recAgainst.push(c.id); }
  }
  const person = l.claims.find((c) => c.source === "person" && c.kind === "recruiting");
  const belief = person ? (person.value === "yes" ? 1 : 0) : sigmoid(logit);

  // 2. which type? every claim that names one adds its weight; nothing is removed.
  const tally = new Map<string, { weight: number; ids: string[] }>();
  const vote = (type: string, w: number, id: string) => { const t = tally.get(type) ?? { weight: 0, ids: [] }; t.weight += w; t.ids.push(id); tally.set(type, t); };
  for (const c of l.claims) {
    if (c.kind === "event_type") {
      const base = c.source === "person" ? C.personWeight : c.source === "model" ? C.modelWeight : C.ruleWeight;
      vote(c.value, base * c.strength * (c.source !== "person" && isLowInformation(c.value) ? C.lowInformationFactor : 1), c.id);
    } else if (c.kind === "fact" && c.value in C.typeFact) {
      const f = (C.typeFact as Record<string, { type: string; weight: number }>)[c.value];
      vote(f.type, f.weight, c.id);
    }
  }
  const ranked = [...tally.entries()].map(([value, t]) => ({ value, weight: round2(t.weight), ids: t.ids })).sort((a, b) => b.weight - a.weight);
  const best = ranked[0] ?? null;
  const typeAgainst = best ? ranked.slice(1).flatMap((r) => r.ids) : [];
  const typeOpposition = ranked.slice(1).reduce((s, r) => s + r.weight, 0);

  // 3. how settled is it?
  const sources = new Set<string>();
  const typeSources = new Set<string>(); // independent sources that name the WINNING TYPE (wording that only shows "this is my process" does not corroborate an ending)
  const sourceOf = (c: Claim) => (c.source === "fact" ? `fact:${c.value}` : c.source);
  for (const c of l.claims) {
    if (recruitingWeight(c) > 0 || (c.kind === "event_type" && best && c.value === best.value)) sources.add(sourceOf(c));
    if (best && ((c.kind === "event_type" && c.value === best.value) || (c.kind === "fact" && (C.typeFact as Record<string, { type: string }>)[c.value]?.type === best.value))) typeSources.add(sourceOf(c));
  }
  const reasons: string[] = [];
  let state: VerdictState;
  // An OFFER is the most consequential thing a message can claim: when the text itself says it is a welcome, programme or promotional notice rather than about the reader's own process, the offer
  // is contested however much else supports it.
  const offerNotMine = !!best && best.value === "offer" && l.claims.some((c) => c.kind === "fact" && c.value === "not_own_process") && !l.claims.some((c) => c.kind === "fact" && c.value === "own_process_wording");
  const contested = offerNotMine || (opposition >= C.contestFloor && opposition >= C.contestShare * Math.max(support, 0.0001));
  if (person) { state = "settled"; reasons.push(person.value === "yes" ? "person-confirmed" : "person-excluded"); }
  else if (belief < C.possibleAbove) { state = "noise"; reasons.push("below-possible"); }
  else if (contested) { state = "contested"; for (const id of recAgainst) reasons.push(`opposed:${id.split(".").pop()}`); }
  else if (sources.size >= 2) { state = "verified"; reasons.push(`corroborated:${[...sources].sort().join("+")}`); }
  else { state = "proposed"; reasons.push(`single-source:${[...sources][0] ?? "none"}`); }
  if (best && typeOpposition >= C.contestFloor && best.weight < typeOpposition / C.contestShare && state !== "settled") reasons.push("type-disputed");

  const placement = state === "settled" ? (belief >= 0.5 ? "pipeline" : "none") : belief >= C.pipelineAbove && state !== "contested" ? "pipeline" : belief >= C.possibleAbove ? "possible" : "none";
  const terminal: Terminal = !isTerminalType(best?.value ?? null) ? "none" : state === "settled" ? "verified" : state === "contested" || state === "noise" || placement !== "pipeline" ? "none" : typeSources.size >= 2 ? "verified" : "proposed";

  return {
    engine: DECISION_VERSION,
    messageId: l.messageId,
    state,
    recruiting: { belief: round2(belief), logit: round2(logit), for: recFor, against: recAgainst },
    type: { value: best?.value ?? null, weight: best?.weight ?? 0, alternatives: ranked.map((r) => ({ value: r.value, weight: r.weight })), for: best?.ids ?? [], against: typeAgainst },
    terminal,
    reasons,
    placement,
  };
}
