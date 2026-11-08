/**
 * Frozen parameters of the prospective evaluation (docs/prospective-evaluation-protocol.md). Dependency-free on purpose:
 * collection, sampling, labeling and analysis all read the same constants, and nothing is configurable through the
 * environment. In particular the cutoff cannot be mis-set: a historical message can never be classified as prospective
 * by a stray variable, and the database enforces the same rule (migration 0006). Changing any value here changes the
 * candidate and starts a new protocol; the freeze tag covers this file.
 */
export const FROZEN = {
  protocol: "prospective-1",
  freezeTag: "arch-v2-shadow-candidate-2",
  /**
   * candidate-1 was created and then superseded the same day, BEFORE any prospective evidence existed, after a freeze-integrity
   * audit found competing literals in a test fixture and inaccurate wording in the protocol (no change to the architecture,
   * thresholds, statistics, sampling design, cutoff or privacy policy). It is kept as an immutable record and is never used.
   */
  supersedes: { tag: "arch-v2-shadow-candidate-1", commit: "aa9c0c0a3da2cfbd7d2654cf4f77b1c83e7fabcd", date: "2026-11-08" },

  /** Mail arriving at or after this instant is eligible. Fixed; it is also a CHECK constraint in the database. */
  cutoff: "2026-12-01T00:00:00.000Z",
  /**
   * The tag must exist by this instant: the later of "2026-11-24" and "7 days before the cutoff" works out to exactly
   * 2026-11-24 00:00 UTC (a tag created later on the 24th would be under 7 days before the cutoff).
   */
  tagDeadline: "2026-11-24T00:00:00.000Z",
  minDaysTagBeforeCutoff: 7,
  /** After this instant the analysis runs whatever evidence exists; insufficient evidence then means "inconclusive". */
  hardStop: "2027-03-29T00:00:00.000Z",
  /** Only mail arriving before this instant is analyzed, leaving the final 14 days for reading and labeling. */
  eligibleThrough: "2027-03-15T00:00:00.000Z",
  minWeeksAfterCutoff: 8,

  /** Share of S2 (non-census) mail that is sampled; sampled S2 observations carry weight 1/rate. */
  uniformRate: 0.25,
  s2Weight: 4,
  armHash: "uniform-arm-v1",

  pipelineVersion: "arch-v2.0",
  readerVersion: "reader-s1-gb56d5132a955",
  extractorVersion: "2026.11.2-evidence",

  datasetPrefix: "prospective-1-",
  /** Gmail messages are labeled within this many days of arrival. */
  labelWithinDays: 14,

  interval: { confidence: 0.95, z: 1.96 },
  bootstrap: { resamples: 10000, seed: 20261201 },

  /**
   * Primary claims. For "at least" claims: point >= target AND lower bound >= lowerMin is SUPPORTED; point < target is
   * NOT SUPPORTED; otherwise INCONCLUSIVE. For "at most" claims the mirror image with upperMax. Improvement: lower bound of
   * the paired difference above 0 is supported, point <= 0 is not supported, otherwise inconclusive.
   */
  claims: {
    improvement: { lowerAbove: 0 },
    strictRecall: { target: 0.8, lowerMin: 0.7 },
    precision: { target: 0.8, lowerMin: 0.7 },
    typeAccuracy: { target: 0.8, lowerMin: 0.7 },
    agreementError: { target: 0.02, upperMax: 0.04 },
    reviewRate: { target: 0.08, upperMax: 0.12 },
    ungrounded: { max: 0 },
  },

  /**
   * Design truths the minimum evidence is powered against (see docs/prospective-power-analysis.md). A system whose true
   * rate for each "at least" claim is 0.90, whose true agreement-region error is 1%, whose true review rate is 5%, and whose
   * paired table is {only v2 0.20, only comparator 0.02, both 0.60}, is declared SUPPORTED with probability at least `power`.
   */
  powerDesign: { power: 0.8, rate: 0.9, agreementError: 0.01, reviewRate: 0.05, paired: { onlyV2: 0.2, onlyComparator: 0.02, both: 0.6 } },

  /**
   * Minimum EFFECTIVE sample size (thread/opportunity-clustered, weight-adjusted) per claim before the single analysis may
   * run. Derived by `npm run shadow -- power` from the analysis code itself; a test recomputes and compares them.
   * Not reaching them by the hard stop makes the outcome "inconclusive": the bar is never lowered.
   */
  minimumEvidence: { recallPositives: 45, precisionDecisions: 35, typeDecisions: 35, agreementRows: 253, reviewReads: 148 },
} as const;

export type Frozen = typeof FROZEN;
