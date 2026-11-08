import { sameOrg } from "../reader/reconcile.ts";
import { FROZEN } from "./frozen.ts";
import type { Stratum } from "./labelset.ts";
import { atLeast, atMost, clusterProportion, effectiveSize, improves, pairedDifference, type Estimate, type PairUnit, type PairedEstimate, type Unit, type Verdict } from "./stats.ts";

/**
 * The single prospective analysis (docs/prospective-evaluation-protocol.md). Pure: takes labeled rows joined to what the
 * system said, returns every metric. Nothing here reads a database, a file or a clock.
 *
 * Definitions are fixed by the protocol:
 *  - Review rows are excluded from precision (neither true nor false positives) and count as misses for strict recall.
 *  - Sensitivity analyses (e.g. precision if review were resolved by the model's suggestion) are computed in a separate
 *    structure that `decide()` never reads, so they cannot influence any verdict.
 *  - Clusters: a labeled positive is clustered by its hiring process (the labeled opportunity), everything else by thread,
 *    always within one mailbox. One hiring process spans many threads (in the held-out run 5 of 7 positives were one
 *    employer's process), so thread-only clustering would overstate the evidence.
 */
export type AnalysisRow = {
  mailbox: string;
  messageId: string;
  threadId: string;
  stratum: Stratum;
  weight: number;
  label: {
    positive: boolean;
    /** Reader-taxonomy event type; null when the labeler said unknown or not applicable. */
    type: string | null;
    /** Null when unknown. */
    company: string | null;
    /** "not_applicable" means the message states no role; null means unknown (excluded). */
    role: string | null;
    opportunity: string | null;
  };
  v2: {
    state: "recruiting" | "not_recruiting" | "review";
    reviewReason: string | null;
    modelSuggests: "recruiting" | "not_recruiting" | null;
    finalType: string | null;
    finalCompany: string | null;
    finalRole: string | null;
    isCandidate: boolean;
    plannedRead: boolean;
    modelRead: boolean;
    /** Null when the model read was never audited (a protocol violation the CLI refuses to analyze). */
    ungrounded: number | null;
  };
  /** The current product found it: the keyword query matched AND the rules said recruiting. */
  legacyFound: boolean;
};

/** Counts over ALL prospective rows in the window (labeled or not), used only for the cost estimate. */
export type Population = { candidateRows: number; plannedReads: number; vetoed: number; legacyOnlyRows: number; nonCandidateArmRows: number };

export const clusterOf = (r: AnalysisRow) => `${r.mailbox}|${r.label.positive && r.label.opportunity ? `o:${r.label.opportunity}` : `t:${r.threadId}`}`;

const unit = (r: AnalysisRow, s: boolean): Unit => ({ w: r.weight, s: s ? 1 : 0, c: clusterOf(r) });
const E = FROZEN.claims;
const MIN = FROZEN.minimumEvidence;

export type ClaimId = "improvement" | "strictRecall" | "precision" | "typeAccuracy" | "agreementError" | "reviewRate" | "ungrounded";
export type ClaimOutcome = {
  id: ClaimId;
  title: string;
  rule: string;
  /** The point estimate (a difference for "improvement", a count for "ungrounded"). */
  estimate: number;
  lo: number;
  hi: number;
  effectiveN: number;
  requiredN: number;
  evidenceMet: boolean;
  verdict: Verdict;
};

export type Overall = "supported" | "not_supported" | "inconclusive";

const pctRule = (t: number, l: number) => `point >= ${t * 100}% and lower bound >= ${l * 100}%`;

export function computeAnalysis(rows: AnalysisRow[], population?: Population) {
  const positives = rows.filter((r) => r.label.positive);
  const found = (r: AnalysisRow) => r.v2.state === "recruiting";

  // ---- primary ----
  const recallUnits = positives.map((r) => unit(r, found(r)));
  const pairUnits: PairUnit[] = positives.map((r) => ({ w: r.weight, a: found(r) ? 1 : 0, b: r.legacyFound ? 1 : 0, c: clusterOf(r), g: r.mailbox }));
  const decisions = rows.filter(found);
  const precisionUnits = decisions.map((r) => unit(r, r.label.positive));
  const typeRows = positives.filter((r) => found(r) && r.label.type !== null);
  const typeUnits = typeRows.map((r) => unit(r, r.v2.finalType === r.label.type));
  const agreementRows = rows.filter((r) => r.stratum === "S1" && r.v2.plannedRead && r.v2.modelRead && r.v2.state !== "review");
  const agreementUnits = agreementRows.map((r) => unit(r, (r.v2.state === "recruiting") !== r.label.positive));
  const readRows = rows.filter((r) => r.stratum === "S1" && r.v2.plannedRead && r.v2.modelRead);
  const reviewUnits = readRows.map((r) => unit(r, r.v2.state === "review"));
  const audited = rows.filter((r) => r.v2.modelRead);
  const ungroundedCount = audited.reduce((n, r) => n + (r.v2.ungrounded ?? 1), 0); // an unaudited read counts against the claim

  const strict = clusterProportion(recallUnits);
  const paired: PairedEstimate = pairedDifference(pairUnits, FROZEN.bootstrap.resamples, FROZEN.bootstrap.seed, FROZEN.interval.confidence);
  const precision = clusterProportion(precisionUnits);
  const typeAcc = clusterProportion(typeUnits);
  const agreement = clusterProportion(agreementUnits);
  const review = clusterProportion(reviewUnits);

  const nRecall = effectiveSize(recallUnits);
  const claim = (id: ClaimId, title: string, rule: string, e: { estimate: number; lo: number; hi: number }, effectiveN: number, requiredN: number, verdict: Verdict): ClaimOutcome => ({
    id, title, rule, ...e, effectiveN, requiredN, evidenceMet: effectiveN >= requiredN, verdict,
  });

  const claims: ClaimOutcome[] = [
    claim("improvement", "Strict end-to-end recall improves on the current product (paired)", `lower 95% bound of (v2 - current) > ${E.improvement.lowerAbove}`,
      { estimate: paired.d, lo: paired.lo, hi: paired.hi }, nRecall, MIN.recallPositives, improves(paired, E.improvement.lowerAbove)),
    claim("strictRecall", "Absolute strict end-to-end recall", pctRule(E.strictRecall.target, E.strictRecall.lowerMin),
      { estimate: strict.p, lo: strict.lo, hi: strict.hi }, nRecall, MIN.recallPositives, atLeast(strict, E.strictRecall.target, E.strictRecall.lowerMin)),
    claim("precision", "Precision of v2 recruiting decisions (review excluded)", pctRule(E.precision.target, E.precision.lowerMin),
      { estimate: precision.p, lo: precision.lo, hi: precision.hi }, precision.nEff, MIN.precisionDecisions, atLeast(precision, E.precision.target, E.precision.lowerMin)),
    claim("typeAccuracy", "Event-type accuracy among positives v2 called recruiting", pctRule(E.typeAccuracy.target, E.typeAccuracy.lowerMin),
      { estimate: typeAcc.p, lo: typeAcc.lo, hi: typeAcc.hi }, typeAcc.nEff, MIN.typeDecisions, atLeast(typeAcc, E.typeAccuracy.target, E.typeAccuracy.lowerMin)),
    claim("agreementError", "Error when the two readers agree", `point <= ${E.agreementError.target * 100}% and upper bound <= ${E.agreementError.upperMax * 100}%`,
      { estimate: agreement.p, lo: agreement.lo, hi: agreement.hi }, agreement.nEff, MIN.agreementRows, atMost(agreement, E.agreementError.target, E.agreementError.upperMax)),
    claim("reviewRate", "Review rate among messages the model read", `point <= ${E.reviewRate.target * 100}% and upper bound <= ${E.reviewRate.upperMax * 100}%`,
      { estimate: review.p, lo: review.lo, hi: review.hi }, review.nEff, MIN.reviewReads, atMost(review, E.reviewRate.target, E.reviewRate.upperMax)),
    // Zero tolerance: a single ungrounded value fails the claim whatever the sample size; with no reads at all it cannot be assessed.
    claim("ungrounded", "Ungrounded structured values surviving verification", `count <= ${E.ungrounded.max}`,
      { estimate: ungroundedCount, lo: ungroundedCount, hi: ungroundedCount }, audited.length, 1, audited.length === 0 ? "inconclusive" : ungroundedCount <= E.ungrounded.max ? "supported" : "not_supported"),
  ];

  // ---- secondary (reported, never decisive) ----
  const decided = positives.filter((r) => r.v2.state !== "review");
  const companyRows = positives.filter((r) => found(r) && r.label.company !== null);
  const roleRows = positives.filter((r) => found(r) && r.label.role !== null);
  const secondary = {
    decidedRecall: clusterProportion(decided.map((r) => unit(r, found(r)))),
    candidateRecall: clusterProportion(positives.map((r) => unit(r, r.v2.isCandidate))),
    currentProductRecall: clusterProportion(positives.map((r) => unit(r, r.legacyFound))),
    typeAccuracyUnconditional: clusterProportion(positives.filter((r) => r.label.type !== null).map((r) => unit(r, found(r) && r.v2.finalType === r.label.type))),
    companyAccuracy: clusterProportion(companyRows.map((r) => unit(r, sameOrg(r.v2.finalCompany, r.label.company)))),
    roleAccuracy: clusterProportion(roleRows.map((r) => unit(r, r.label.role === "not_applicable" ? !r.v2.finalRole : sameOrg(r.v2.finalRole, r.label.role)))),
    reviewByReason: countBy(rows.filter((r) => r.v2.state === "review"), (r) => r.v2.reviewReason ?? "none"),
    perMailbox: Object.fromEntries([...new Set(rows.map((r) => r.mailbox))].sort().map((m) => {
      const mine = rows.filter((r) => r.mailbox === m);
      const pos = mine.filter((r) => r.label.positive);
      return [m, { positives: pos.length, strictRecall: clusterProportion(pos.map((r) => unit(r, found(r)))).p, precision: clusterProportion(mine.filter(found).map((r) => unit(r, r.label.positive))).p }];
    })),
    cost: population ? estimateCost(population) : null,
  };

  // ---- sensitivity: NEVER read by decide() ----
  const byModel = (r: AnalysisRow) => found(r) || (r.v2.state === "review" && r.v2.modelSuggests === "recruiting");
  const anyReview = (r: AnalysisRow) => found(r) || r.v2.state === "review";
  const sensitivity = {
    precisionIfReviewResolvedByModelSuggestion: clusterProportion(rows.filter(byModel).map((r) => unit(r, r.label.positive))),
    strictRecallIfReviewResolvedByModelSuggestion: clusterProportion(positives.map((r) => unit(r, byModel(r)))),
    precisionIfEveryReviewCountedPositive: clusterProportion(rows.filter(anyReview).map((r) => unit(r, r.label.positive))),
  };

  const counts = {
    labeledRows: rows.length,
    s1: rows.filter((r) => r.stratum === "S1").length,
    s2: rows.filter((r) => r.stratum === "S2").length,
    positives: positives.length,
    s1Positives: positives.filter((r) => r.stratum === "S1").length,
    s2Positives: positives.filter((r) => r.stratum === "S2").length,
    v2Recruiting: decisions.length,
    v2Review: rows.filter((r) => r.v2.state === "review").length,
    modelReads: audited.length,
    positiveClusters: new Set(positives.map(clusterOf)).size,
  };

  return { counts, claims, secondary, sensitivity, decision: decide(claims) };
}

export type AnalysisResult = ReturnType<typeof computeAnalysis>;

/**
 * The outcome rule, fixed in advance:
 *  - NOT SUPPORTED if any claim that has its required evidence fails its point target (the conjunction is already broken).
 *  - SUPPORTED only if every claim has its required evidence and is supported.
 *  - otherwise INCONCLUSIVE: some claim lacks the evidence, or its point passes but its interval does not. Missing evidence
 *    at the hard stop therefore yields "inconclusive"; the bar is never lowered.
 * Per-claim verdicts on claims WITHOUT sufficient evidence are descriptive only.
 */
export function decide(claims: ClaimOutcome[]): { overall: Overall; reasons: string[] } {
  const reasons: string[] = [];
  const failed = claims.filter((c) => c.evidenceMet && c.verdict === "not_supported");
  if (failed.length > 0) return { overall: "not_supported", reasons: failed.map((c) => `${c.id}: point estimate misses the target with sufficient evidence`) };
  for (const c of claims) {
    if (!c.evidenceMet) reasons.push(`${c.id}: insufficient evidence (effective n ${c.effectiveN.toFixed(1)} of ${c.requiredN})`);
    else if (c.verdict === "inconclusive") reasons.push(`${c.id}: point estimate passes but the interval does not clear the requirement`);
  }
  return reasons.length === 0 ? { overall: "supported", reasons: [] } : { overall: "inconclusive", reasons };
}

function countBy<T>(xs: T[], f: (x: T) => string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1;
  return o;
}

/** Model reads per 100 eligible messages; non-candidates outside the arm are not recorded, so they are estimated from the arm. */
export function estimateCost(p: Population) {
  const nonCandidateEstimate = p.nonCandidateArmRows / FROZEN.uniformRate;
  const eligible = p.candidateRows + p.legacyOnlyRows + nonCandidateEstimate;
  return { modelReads: p.plannedReads, eligibleEstimate: eligible, readsPer100: eligible > 0 ? (100 * p.plannedReads) / eligible : NaN, vetoed: p.vetoed };
}

// ---- report ----
const pc = (x: number) => (Number.isNaN(x) ? "n/a" : `${(100 * x).toFixed(1)}%`);
const est = (e: Estimate) => `${pc(e.p)} [${pc(e.lo)}, ${pc(e.hi)}] (effective n ${e.nEff.toFixed(1)}, ${e.units} units in ${e.clusters} clusters)`;

export function formatAnalysis(a: AnalysisResult, header: string[]): string {
  const L: string[] = [...header, ""];
  L.push(`OUTCOME: ${a.decision.overall.toUpperCase().replace("_", " ")}`);
  for (const r of a.decision.reasons) L.push(`  - ${r}`);
  L.push("", "PRIMARY CLAIMS (95% intervals; thread/opportunity-clustered, weight-adjusted)");
  for (const c of a.claims) {
    const value = c.id === "improvement" ? `${(100 * c.estimate).toFixed(1)} points [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]` : c.id === "ungrounded" ? `${c.estimate}` : `${pc(c.estimate)} [${pc(c.lo)}, ${pc(c.hi)}]`;
    L.push(`${c.verdict.toUpperCase().padEnd(13)} ${c.title}`, `              ${value}; rule: ${c.rule}; evidence ${c.effectiveN.toFixed(1)}/${c.requiredN}${c.evidenceMet ? "" : " (INSUFFICIENT: verdict is descriptive only)"}`);
  }
  const n = a.counts;
  L.push("", `COUNTS: ${n.labeledRows} labeled (S1 ${n.s1}, S2 ${n.s2}); positives ${n.positives} (S1 ${n.s1Positives}, S2 ${n.s2Positives}) in ${n.positiveClusters} clusters; v2 recruiting ${n.v2Recruiting}, review ${n.v2Review}; model reads ${n.modelReads}`);
  const s = a.secondary;
  L.push("", "SECONDARY (reported, never decisive)",
    `decided recall (review excluded)      ${est(s.decidedRecall)}`,
    `candidate recall                      ${est(s.candidateRecall)}`,
    `current-product recall (comparator)   ${est(s.currentProductRecall)}`,
    `type accuracy, unconditional          ${est(s.typeAccuracyUnconditional)}`,
    `employer accuracy (normalized)        ${est(s.companyAccuracy)}`,
    `role accuracy                         ${est(s.roleAccuracy)}`,
    `review by reason                      ${JSON.stringify(s.reviewByReason)}`,
    `per mailbox                           ${JSON.stringify(s.perMailbox)}`,
    s.cost ? `cost: ${s.cost.modelReads} model reads, about ${s.cost.readsPer100.toFixed(1)} per 100 eligible messages (eligible estimated at ${s.cost.eligibleEstimate.toFixed(0)}; ${s.cost.vetoed} vetoed)` : "cost: not computed");
  const v = a.sensitivity;
  L.push("", "SENSITIVITY ANALYSES (cannot determine the outcome)",
    `precision if review were resolved by the model's suggestion   ${est(v.precisionIfReviewResolvedByModelSuggestion)}`,
    `strict recall if review were resolved by the suggestion       ${est(v.strictRecallIfReviewResolvedByModelSuggestion)}`,
    `precision if every review row were counted as positive        ${est(v.precisionIfEveryReviewCountedPositive)}`);
  return L.join("\n");
}
