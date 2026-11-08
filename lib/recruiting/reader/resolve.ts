/**
 * EXPERIMENT, REJECTED ON DEVELOPMENT EVIDENCE. Not used by the pipeline (see pipeline.ts) and not to be wired in.
 * Kept so the result is reproducible (`npm run arch -- compare`, `adj-wrong`). On the 34 development messages that needed
 * it, the adjudicator decided 30 and was right 12 times; in 11 of the 12 right verdicts it sided with the language model,
 * so it added little independent evidence, and its guide conflicted with how development labels treat programs and
 * fellowships. Forced decisions cost 11-25 errors per 1,000 messages versus 7 for consensus-and-review.
 * Details: docs/architecture-milestone-2.md.
 */
import type { VerifiedAdjudication } from "./adjudicate.ts";
import { reconcile, type Reading, type Reconciled } from "./reconcile.ts";
import type { VerifiedOutput } from "./types.ts";

/**
 * Resolution v2. Two first-pass readers vote; a disagreement (or a model that could not decide) is sent to the
 * adjudicator; whatever the adjudicator cannot back with a verified quote stays in review.
 *
 *   readers agree                         -> accepted, fields reconciled exactly as the frozen reconcile() does
 *   readers disagree / model abstained    -> needs adjudication (state "review" until a verified verdict exists)
 *   verified adjudication, not unsure     -> its verdict decides
 *   anything else                         -> review
 *
 * There is no "who wins" default and no threshold: the evidence is read, not weighted by a constant.
 */
export type Resolution = Reconciled & {
  basis: "agree" | "adjudicated" | "unresolved";
  needsAdjudication: boolean;
};

const modelUsable = (m: VerifiedOutput | null): m is VerifiedOutput => !!m && m.status === "ok" && m.certainty !== "low";

export function needsAdjudication(rules: Reading, model: VerifiedOutput | null): boolean {
  // A message the model never read (triage vetoed it) has no second reader and nothing to adjudicate.
  if (!model) return false;
  return !modelUsable(model) || rules.recruiting !== model.recruiting;
}

export function resolve(rules: Reading, model: VerifiedOutput | null, adj: VerifiedAdjudication | null): Resolution {
  const frozen = reconcile(rules, model);
  if (!needsAdjudication(rules, model)) return { ...frozen, basis: "agree", needsAdjudication: false };

  const review = (): Resolution => ({ ...frozen, state: "review", basis: "unresolved", needsAdjudication: true });
  if (!adj || adj.status !== "ok" || adj.verdict === "unsure" || adj.certainty === "low") return review();

  if (adj.verdict === "no") {
    return { ...frozen, state: "not_recruiting", reason: "disagree", basis: "adjudicated", needsAdjudication: true, modelSuggests: null, type: null, typeReview: false, company: null, companyReview: false, role: null, roleReview: false };
  }
  // verdict yes: only one first-pass reader supported it, so its fields are used but flagged for review.
  const src: Reading = modelUsable(model) && model.recruiting
    ? { recruiting: true, type: model.type, company: model.company, role: model.role }
    : rules;
  return { ...frozen, state: "recruiting", reason: "disagree", basis: "adjudicated", needsAdjudication: true, modelSuggests: null, type: src.type, typeReview: true, company: src.company, companyReview: !!src.company, role: src.role, roleReview: !!src.role };
}
