import { closureFact, marketingFact } from "../reliability/evidence.ts";
import { explicitOffer } from "../reliability/facts.ts";
import { CONFLICT_PREFIX, MEMBERSHIP_PREFIX, isNearMiss, isWeakNearMiss } from "../reliability/flags.ts";
import { notAProcess, ownProcessWording } from "../semantic/assist.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { LEDGER_VERSION, claimId, parseLedger, type Claim, type ClaimKind, type ClaimSource, type FactName, type MessageLedger } from "./types.ts";

/** How sure the model said it was, as a claim strength. */
export const CERTAINTY_STRENGTH = { high: 0.9, medium: 0.6, low: 0.3 } as const;
/** A rule near miss is a close call, not a finding. */
const NEAR_MISS_STRENGTH = { strong: 0.4, weak: 0.2 } as const;

export type PersonInput = { type?: string; confirmed?: boolean; notRecruiting?: boolean };
export type BuildOptions = { readerVersion: string; modelName?: string; person?: PersonInput };

const add = (out: Claim[], source: ClaimSource, producer: string, kind: ClaimKind, value: string, strength: number, grounding: Claim["grounding"] = null) => {
  const id = claimId(source, producer, kind, value);
  if (out.some((c) => c.id === id)) return; // one claim per (source, producer, kind, value): the stronger first reading stands
  out.push({ id, source, producer, kind, value, strength: Math.round(Math.min(1, Math.max(0, strength)) * 100) / 100, grounding });
};

/** Deterministic properties of the text. Nothing from the text is kept: each is a yes/no. */
export function factClaims(email: RecruitingEmail): Claim[] {
  const out: Claim[] = [];
  const fact = (name: FactName, producer: string) => add(out, "fact", producer, "fact", name, 1);
  if (closureFact(email)) fact("closure_wording", "closureFact");
  const mk = marketingFact(email);
  if (mk === "alert") fact("marketing_alert", "marketingFact");
  if (mk === "bulk") fact("marketing_bulk", "marketingFact");
  if (notAProcess(email)) fact("not_own_process", "notAProcess");
  if (ownProcessWording(email)) fact("own_process_wording", "ownProcessWording");
  if (explicitOffer(email)) fact("explicit_offer", "explicitOffer");
  return out;
}

/**
 * Every reading of one message, kept side by side. `rule` is what the deterministic reader produced BEFORE any model stage touched it; `reading` is the verified model output.
 * Neither argument is modified, and a claim a later stage disagrees with stays in the ledger: disagreement is information, not an error to clean up.
 */
export function buildLedger(email: RecruitingEmail, rule: ExtractedEvent | null, reading: VerifiedOutput | null | undefined, opts: BuildOptions): MessageLedger {
  const claims: Claim[] = [];
  if (rule && !rule.outbound) {
    const near = isNearMiss(rule);
    const strength = near ? (isWeakNearMiss(rule) ? NEAR_MISS_STRENGTH.weak : NEAR_MISS_STRENGTH.strong) : rule.confidence;
    add(claims, "rule", "rules", "recruiting", "yes", strength);
    add(claims, "rule", "rules", "event_type", rule.type, near ? strength : (rule.fieldConfidence?.type ?? rule.confidence));
    if (rule.company) add(claims, "rule", "rules", "employer", rule.company.slice(0, 80), rule.fieldConfidence?.company ?? 0.5);
    if (rule.role) add(claims, "rule", "rules", "role", rule.role.slice(0, 80), rule.fieldConfidence?.role ?? 0.5);
    const reasons = rule.reviewReasons ?? [];
    if (reasons.some((r) => r.startsWith(MEMBERSHIP_PREFIX))) add(claims, "fact", "ruleReader", "fact", "rule_doubt_membership", 1);
    if (reasons.some((r) => r.startsWith(CONFLICT_PREFIX))) add(claims, "fact", "ruleReader", "fact", "rule_doubt_conflict", 1);
  }
  // Every verified reading is kept, whatever its certainty: a weak claim is still evidence, and it is weighed, not dropped.
  if (reading && reading.status === "ok") {
    const producer = opts.modelName ?? "model";
    const s = CERTAINTY_STRENGTH[reading.certainty];
    add(claims, "model", producer, "recruiting", reading.recruiting ? "yes" : "no", s, reading.evidence);
    if (reading.recruiting && reading.type) add(claims, "model", producer, "event_type", reading.type, s, reading.evidence);
    if (reading.recruiting && reading.company) add(claims, "model", producer, "employer", reading.company.slice(0, 80), reading.companySource === "candidate" ? 0.8 : 0.7);
    if (reading.recruiting && reading.role) add(claims, "model", producer, "role", reading.role.slice(0, 80), 0.6);
  }
  for (const c of factClaims(email)) add(claims, c.source, c.producer, c.kind, c.value, c.strength);
  const p = opts.person;
  if (p?.notRecruiting) add(claims, "person", "owner", "recruiting", "no", 1);
  else if (p?.type) { add(claims, "person", "owner", "recruiting", "yes", 1); add(claims, "person", "owner", "event_type", p.type, 1); }
  else if (p?.confirmed) add(claims, "person", "owner", "recruiting", "yes", 1);
  return parseLedger({ version: LEDGER_VERSION, messageId: email.id, threadId: email.threadId, receivedAt: email.receivedAt.toISOString(), outbound: email.outbound ?? false, senderDomain: senderDomainOf(email.from), readerVersion: opts.readerVersion, claims });
}

function senderDomainOf(from: string): string {
  const m = /@([A-Za-z0-9.-]+)/.exec(from);
  return (m?.[1] ?? "").toLowerCase().slice(0, 120);
}
