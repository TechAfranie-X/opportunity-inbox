import { candidateEvent } from "../reliability/assess.ts";
import { NEAR_MISS_WEAK, isNearMiss, isWeakNearMiss } from "../reliability/flags.ts";
import { applyTextFacts, explicitOffer, studentAcceptance } from "../reliability/facts.ts";
import { buildLedger } from "../ledger/build.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import { endingWording, marketingFact, ownApplicationStatement } from "../reliability/evidence.ts";
import { notAProcess } from "../semantic/assist.ts";
import { evidenceSignals } from "../reliability/evidence-signals.ts";
import { requisitionOf } from "../identity/represented-employer.ts";
import { outboundEvent } from "../recruiting/extract.ts";
import { PRODUCT_READER_VERSION } from "../recruiting/product-version.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { DECISIVE, ENDINGS, SEMANTIC_EXCLUDED, asEventType, interviewKind, semanticEvent } from "../semantic/assist.ts";
import { SECOND_READER_NO, SECOND_READER_YES } from "../semantic/consensus.ts";
import { usable } from "../semantic/port.ts";
import { DECISION_CONFIG as C } from "./config.ts";
import { decide, type Verdict } from "./engine.ts";

/**
 * SHADOW MODE. A drop-in for `applyAssist` that decides from the evidence ledger instead of a chain of gates. Nothing in the product calls it: it runs next to the existing
 * pipeline on identical readings (scripts/eval-journeys.ts --engine shadow, scripts/eval-compare.ts) so the two can be compared before anything is switched.
 *
 * Differences from `applyAssist`, each a design point and not a tuning:
 *  - a model finding is never discarded for lacking corroboration; it is discarded only when something OPPOSES it (a promotion marker, a second reader's "no"), and then it stays
 *    visible as a question, with the opposing claims named in the verdict;
 *  - an ending (rejection, withdrawal) is a verified outcome when independent evidence supports it, a proposed one when a single unopposed source does, and is withheld when contested;
 *  - the event carries `decision:<state>` so a later phase can show "proposed" differently from "verified".
 * A rule-reader event is never removed here (as in `applyAssist`): the second reader may question it, not delete it.
 */
export const CONTESTED_ENDING = "Another signal disagrees with reading this as an ending, so it was not applied. Is it one?";
const MARGIN = 1.5; // a model's type replaces a rule's low-information type only when it outweighs it by this much (a medium-certainty reading does not)

export type ShadowTrace = Map<string, Verdict>;

/**
 * A rule-found REJECTION settles an application only when the message contains a sentence that ends it. The rule reader types a receipt ("your application has been received") as a rejection now
 * and then; without an ending sentence the ending is only proposed (the application stays active and visible). Pure; needs no model.
 */
export function markUncorroboratedRejections(events: ExtractedEvent[], emails: RecruitingEmail[]): ExtractedEvent[] {
  const byId = new Map(emails.map((m) => [m.id, m] as const));
  return events.map((e) => {
    const m = byId.get(e.gmailMessageId);
    return m && !e.outbound && !isNearMiss(e) && e.type === "rejection" && !e.signals.includes("terminal:proposed") && !endingWording(m) ? { ...e, signals: [...e.signals, "terminal:proposed"] } : e;
  });
}

export function shadowAssist(events: ExtractedEvent[], emails: RecruitingEmail[], opinions: Map<string, VerifiedOutput>, trace?: ShadowTrace): ExtractedEvent[] {
  if (opinions.size === 0) return events;
  const byId = new Map(emails.map((m) => [m.id, m] as const));
  const verdictFor = (m: RecruitingEmail, rule: ExtractedEvent | null, op: VerifiedOutput | undefined): Verdict => {
    const v = decide(buildLedger(m, rule, op, { readerVersion: PRODUCT_READER_VERSION, modelName: "local-model" }));
    trace?.set(m.id, v);
    return v;
  };
  const withState = (e: ExtractedEvent, v: Verdict, extra: string[] = []): ExtractedEvent => ({ ...e, signals: [...e.signals, `decision:${v.state}`, ...(v.terminal !== "none" ? [`terminal:${v.terminal}`] : []), ...extra] });
  const confidenceOf = (v: Verdict) => C.confidence[v.state === "noise" ? "contested" : v.state];
  const modelEvent = (m: RecruitingEmail, op: VerifiedOutput, v: Verdict): ExtractedEvent => {
    const type = (v.type.value ?? op.type ?? "status_update") as VerifiedOutput["type"];
    const base = semanticEvent(m, { ...op, type });
    const conf = confidenceOf(v);
    return withState({ ...base, confidence: conf, fieldConfidence: { type: conf, company: base.fieldConfidence?.company ?? 0, role: 0 } }, v);
  };

  const out = events.map((e0) => {
    let e = e0;
    const m = byId.get(e.gmailMessageId);
    if (!m || e.outbound) return e;
    e = markUncorroboratedRejections([e], emails)[0];
    const op = opinions.get(e.gmailMessageId);
    const v = verdictFor(m, e, op);
    if (!usable(op)) return e;
    if (isNearMiss(e)) {
      if (/could not read/.test((e.reviewReasons ?? []).join(" "))) return e;
      if (!op.recruiting) {
        // Excluded only when the belief really is below the line; a model "no" that the facts contradict leaves the close call in front of a person.
        return v.placement === "none" ? { ...e, signals: [...e.signals, "semantic:no", SEMANTIC_EXCLUDED] } : { ...e, reviewReasons: [...new Set([...(e.reviewReasons ?? []), SECOND_READER_NO])], signals: [...e.signals, "semantic:no", `decision:${v.state}`] };
      }
      if (v.placement === "pipeline") return { ...modelEvent(m, op, v), company: e.company ?? semanticEvent(m, op).company };
      if (isWeakNearMiss(e)) return withState({ ...e, signals: [...e.signals.filter((s) => s !== NEAR_MISS_WEAK), "semantic:yes"], reviewReasons: [SECOND_READER_YES] }, v);
      return withState(e, v);
    }
    if (!op.recruiting) return withState({ ...e, reviewReasons: [...new Set([...(e.reviewReasons ?? []), SECOND_READER_NO])], signals: [...e.signals, "semantic:no"] }, v);
    // Make a low-information type specific when the evidence for the specific type clearly outweighs the receipt's own, and nothing material opposes it.
    const target = v.type.value;
    const current = v.type.alternatives.find((a) => a.value === e.type)?.weight ?? 0;
    const allowed = target !== null && target !== e.type && (e.type === "status_update" || (e.type === "applied" ? ENDINGS.has(target) : e.type === "follow_up" ? DECISIVE.has(target) : false));
    const retype = allowed && v.state !== "contested" && v.state !== "noise" && (v.type.weight - current) >= MARGIN;
    const contestedEnding = allowed && v.state === "contested" && (target === "rejection" || target === "withdrawn");
    // A retyped event carries the confidence of the evidence for its NEW type, not of the receipt it replaced (a type the ledger supports must not stay below the line the lifecycle trusts).
    const lifted = retype ? Math.max(e.fieldConfidence?.type ?? e.confidence, confidenceOf(v)) : null;
    const next = applyTextFacts(m, { ...e, type: interviewKind(m, retype ? asEventType(target) : e.type), ...(lifted !== null ? { confidence: Math.max(e.confidence, lifted), fieldConfidence: { type: lifted, company: e.fieldConfidence?.company ?? 0, role: e.fieldConfidence?.role ?? 0 } } : {}), signals: [...e.signals, retype ? "semantic:type" : "semantic:agree"], reviewReasons: contestedEnding ? [...new Set([...(e.reviewReasons ?? []), CONTESTED_ENDING])] : e.reviewReasons });
    return withState(next, v);
  });

  const have = new Set(out.map((e) => e.gmailMessageId));
  const added = emails.flatMap((m) => {
    if (m.outbound || have.has(m.id)) return [];
    const op = opinions.get(m.id);
    if (!usable(op) || !op.recruiting) return [];
    const v = verdictFor(m, null, op);
    if (v.placement === "pipeline") return [modelEvent(m, op, v)];
    if (v.placement === "possible") return [withState(candidateEvent(m, "strong", v.state === "contested" && v.terminal === "none" && v.type.value === "rejection" ? CONTESTED_ENDING : SECOND_READER_YES, ["semantic:yes"]), v)];
    return [];
  });
  // The person's own replies in a thread a model-found anchor recognised (an acceptance, a withdrawal), exactly as `applyAssist` keeps them.
  const all = [...out, ...added];
  const anchors = new Map<string, ExtractedEvent>();
  for (const e of all) if (!e.outbound && !anchors.has(e.gmailThreadId)) anchors.set(e.gmailThreadId, e);
  const haveAfter = new Set(all.map((e) => e.gmailMessageId));
  const replies = emails.flatMap((m) => {
    const anchor = anchors.get(m.threadId);
    return m.outbound && anchor && !haveAfter.has(m.id) ? [studentAcceptance(m, outboundEvent(m, anchor))] : [];
  });
  const result = added.length > 0 || replies.length > 0 ? [...all, ...replies].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()) : out;
  // a requisition / job reference number the message states is identity evidence (a deterministic fact; only the id is kept, never text)
  return result.map((e) => {
    const m = byId.get(e.gmailMessageId);
    const id = m && !e.outbound ? requisitionOf(`${m.subject}\n${m.bodyText.slice(0, 3000)}`) : null;
    let out = id && !e.signals.some((x) => x.startsWith("req:")) ? { ...e, signals: [...e.signals, `req:${id}`] } : e;
    // A model-found application is CORROBORATED (and may enter the pipeline) when the message itself states the reader's own application and is not marketing or a notice
    if (m && !e.outbound && e.signals.includes("semantic:event") && !out.signals.includes("entry:corroborated") && ownApplicationStatement(m) && !marketingFact(m) && !notAProcess(m) && (!["offer", "rejection", "withdrawn"].includes(e.type) || (e.type === "offer" ? explicitOffer(m) !== null : endingWording(m)))) out = { ...out, signals: [...out.signals, "entry:corroborated"] };
    if (m) { const extra = evidenceSignals(m, out); if (extra.length > 0) out = { ...out, signals: [...out.signals, ...extra] }; }
    return out;
  });
}
