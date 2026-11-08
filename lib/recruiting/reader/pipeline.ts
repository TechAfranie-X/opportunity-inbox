import type { RecruitingEmail } from "../types.ts";
import { reconcile, type Reading, type Reconciled } from "./reconcile.ts";
import { triage, type TriageResult } from "./triage.ts";
import type { VerifiedOutput } from "./types.ts";

/**
 * Architecture v2: what changed from the frozen candidate, and why (evidence in docs/architecture-milestone-2.md).
 *
 *   1. Candidates come from Gmail's own categories (CANDIDATE_QUERY_V2 in triage.ts), not a keyword query.
 *   2. Which messages the model reads depends on the MESSAGE ALONE (veto-only triage). It no longer depends on what the
 *      rules decided and no longer selects on hiring vocabulary, so a kind of mail nobody anticipated is read, not dropped.
 *   3. The two readers stay independent. Disagreement is not resolved by a default winner (neither reader is reliably
 *      right) and not by a third model read (tried and rejected: see adjudicate.ts); it is surfaced as review, with the
 *      model's suggestion attached.
 *   4. Deterministic verification of every model-supplied value is unchanged.
 */
export type ReadPlan = { read: boolean; reason: TriageResult["reason"] };

/** Whether the model reads this candidate. Takes the message only: by construction it cannot depend on the rules' output. */
export function planRead(email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">): ReadPlan {
  const t = triage(email);
  return { read: t.pass, reason: t.reason };
}

const NOT_READ: Reconciled = { state: "not_recruiting", reason: "agree", modelSuggests: null, type: null, typeReview: false, company: null, companyReview: false, role: null, roleReview: false };

/**
 * Final state for one message. A vetoed message is not recruiting (it carried no hiring signal and was never sent anywhere).
 * A message that should have been read but has no model output yet stays in review rather than being decided by the rules alone.
 */
export function settle(plan: ReadPlan, rules: Reading, model: VerifiedOutput | null): Reconciled {
  if (!plan.read) return NOT_READ;
  if (!model) return { ...NOT_READ, state: "review", reason: "model_abstained" };
  return reconcile(rules, model);
}
