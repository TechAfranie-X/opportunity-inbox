/**
 * Every number the decision engine uses, in one place, with the reason for it. Weights are log-odds contributions: positive supports "this message is part of the reader's own
 * recruiting process" (or the type it names), negative opposes it. They were set from the principles below BEFORE the first run on the development fixtures and are not fitted to any
 * single fixture; a change to this file is a decision-logic change and must pass `npm run eval:gate`.
 *
 * Principles:
 *  - Opposition is measured, absence of corroboration is not. A model that is confident, grounded and unopposed is evidence; a promotion marker or a "no" from another reader is
 *    opposition. (Requiring positive corroboration before trusting the model cost 20 points of lifecycle accuracy; see docs/architecture-review.md.)
 *  - Nothing is deleted. Every claim stays in the ledger; the verdict lists which claims it leaned on and which it overruled.
 *  - A terminal outcome (rejection, withdrawal) is "verified" only with independent support, "proposed" with one unopposed source, and withheld when contested.
 */
export const DECISION_VERSION = "decision-1";

export const DECISION_CONFIG = {
  /** Most mail is not recruiting mail. */
  priorLogit: -0.5,
  /** claim strength (0..1) times this = log-odds contribution of a reader's yes/no. */
  ruleWeight: 3,
  modelWeight: 3,
  /** A person's own correction or confirmation outweighs every automatic reading. */
  personWeight: 8,
  /** Deterministic facts: signed contribution to "this is the reader's own process". */
  recruitingFact: {
    closure_wording: 3,
    ending_wording: 1.5,
    own_process_wording: 1.5,
    explicit_offer: 2.5,
    not_own_process: -2,
    marketing_alert: -3,
    marketing_bulk: -2.5,
    rule_doubt_membership: -1,
    rule_doubt_conflict: 0,
  },
  /** Facts that support a specific event type. */
  typeFact: { closure_wording: { type: "rejection", weight: 3 }, ending_wording: { type: "rejection", weight: 2 }, explicit_offer: { type: "offer", weight: 3 } },
  /** A receipt, a bare status or a nudge says little about what the message really is; the same subject carries a receipt one day and a rejection the next. */
  lowInformationTypes: ["status_update", "applied", "follow_up"],
  lowInformationFactor: 0.4,
  /** probability thresholds on the recruiting belief */
  pipelineAbove: 0.8,
  possibleAbove: 0.35,
  /** Opposition counts as a contest when its weight reaches this share of the support. */
  contestShare: 0.6,
  /** Minimum opposing weight that can contest anything at all. */
  contestFloor: 1.5,
  /** Event confidence written for each state (the product's confidence policy reviews below 0.45). */
  confidence: { settled: 0.95, verified: 0.78, proposed: 0.72, contested: 0.3 },
} as const;

export const TERMINAL_TYPES = ["rejection", "withdrawn"] as const;
