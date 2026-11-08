# Prospective evaluation protocol for architecture v2 (prospective-1)

Status: **FROZEN by the annotated freeze tag named in section 1.** The tag is created only after `npm run shadow -- freeze-check` has passed (section 12). Written 2026-11-08, before any prospective message exists. Nothing below may change after the tag. This is the second freeze candidate; the first was superseded before any evidence existed (section 13). The implementation is `lib/recruiting/shadow/` and `scripts/prospective.ts`; a test fails if this document and the code disagree.

**Purpose.** Gather genuinely untouched evidence about architecture v2 without another Gmail account, by evaluating only mail that arrives after a fixed future cutoff. Historical mail from either mailbox is spent: it was seen, labeled, fitted or used for engineering, and can never be evidence for v2.

**What it can and cannot show.** One person's two mailboxes, one season, one frozen candidate. It can support or fail to support the claims in section 6 for this user's mail. It cannot establish accuracy for other users, other seasons, or another candidate. **It may well end inconclusive** (section 11).

## 1. Frozen parameters
| Parameter | Value |
|---|---|
| Cutoff (eligible mail arrives at or after) | 2026-12-01T00:00:00Z |
| Eligible-through (mail arriving before) | 2027-03-15T00:00:00Z |
| Hard stop (analysis runs whatever evidence exists) | 2027-03-29T00:00:00Z |
| Freeze tag | `arch-v2-shadow-candidate-2`, created before 2026-11-24 00:00 UTC, which is exactly 7 days before the cutoff |
| Minimum time before the analysis (unless the hard stop is reached) | 8 weeks since the cutoff |
| Reader version (guide v3) | `reader-s1-gb56d5132a955` |
| Pipeline version | `arch-v2.0` |
| Rules extractor | `2026.11.2-evidence` (`rules-baseline-2026.11.2-evidence`) |
| Sampling rate for S2 (non-census mail) | 25%, hash `uniform-arm-v1`, sampled observations carry weight 4 (1 / 0.25) |
| Intervals | 95%; Wilson at a thread/opportunity-clustered, weight-adjusted effective size; paired difference by stratified cluster bootstrap, 10,000 resamples, seed 20261201 |
| Label datasets | named `prospective-1-<mailbox hash>-<ISO week>` |
Parameters live in `lib/recruiting/shadow/frozen.ts`. The cutoff and sampling rate are code constants, not configuration: no environment variable can change them, and the database enforces the cutoff (section 2).

## 2. Eligibility and the cutoff
- Eligible: a message in a connected mailbox whose Gmail arrival time is at or after the cutoff and before the eligible-through instant. Eligibility depends on arrival time alone, never on when the message was ingested, so collection lag cannot bias it. Sent mail, spam, trash and drafts are excluded.
- **Historical data cannot be mistaken for prospective, mechanically.** (1) The cohort is computed from the frozen cutoff, never from the environment. (2) A database CHECK constraint (`shadow_reads_cohort_matches_cutoff`, migration 0006) rejects a row marked prospective that arrived before the cutoff and a row marked historical that arrived at or after it. (3) The label-set builder and the analysis re-check every row's arrival time and frozen versions. (4) The analysis refuses rows from synthetic fixtures.
- **The window has not started.** The freeze check requires zero prospective rows and zero prospective label datasets at the time of tagging.

## 3. Collection (no pipeline output is ever shown)
- Product sync stays blocked (`BLIND_SETUP_LOCK=1`) for the whole window, so neither the old nor the new pipeline displays anything about eligible mail. The owner does not open product pages for the window's mail before labeling it.
- `npm run shadow -- collect --user <mailbox>` at least every 3 days. For each eligible message it records only ingestion facts and the readers' routing and rules reading (no text): candidate or not, the current product's keyword-query match, planned read or veto, sampling arm, the rules' reading. Mail the candidate query does not match is recorded only when it is in the sampling arm (metadata only) or matches the old keyword query (the product already fetches that).
- `--dry-run` fetches and classifies exactly like a real run and writes nothing (verified by row counts); `--assume-cutoff` exists only with `--dry-run`.
- Model reads: `export`, an existing development worker reads redacted excerpts, `import` within 7 days of arrival. One read per message, **first read wins** (store-enforced). A failed or invalid worker output is not retried or edited: it stands as recorded (an abstention or invalid status is the system's output). Each import records an independent grounding audit count.
- Ingestion fields are write-once.

## 4. What gets labeled, and how
**Stratum S1:** every eligible message that is a v2 candidate planned for a model read: a census, weight 1.
**Stratum S2:** every other eligible message (triage-vetoed candidates, keyword-only mail, non-candidates) that is in the 25% sampling arm: weight 4.
This set is a function of **ingestion-time facts only** (`is_candidate`, `planned_read`, `uniform_arm`, arrival time, versions). Nothing a reader decided is in the type that feeds the selector; the database query selects only those 11 columns; and tests hand the selector an object that throws if any other property is read, and prove the selection is identical whatever the readers said. Labeling can start before any model read exists.
- Build: `npm run shadow -- label-set --user <mailbox> [--week 2026w49] [--dry-run]` creates one frozen dataset per mailbox and week (suffix `-b`, `-c` for late arrivals) in the private eval store.
- Scope: the fixed recruiting scope (guide v3): employment, internship and contract hiring including the pre-start steps that complete the hire. Courses, scholarships, bootcamps, hackathons, generic programs and administration of an already-started job are not recruiting. Fields: recruiting, type, employer, role, opportunity id, stage, date, actionability.
- Isolation: the isolated labeler (`npm run eval:label -- --dataset <name>`), which loads no prediction, extractor or model output (its import graph is test-enforced). Never from the product UI or any report.
- Timing: within 14 days of arrival, in arrival order, before looking at anything beyond `status` counts.
- Audit before the analysis, predictions still hidden: `npm run eval:audit -- --dataset <name> --no-sample N` with N = max(10, 10% of the dataset's negatives): all positives, all unknown fields and a seeded sample of negatives; corrections are appended superseding labels, never edits. The analysis refuses a dataset without a frozen audit list.
- Messages that cannot be fetched at labeling time are recorded in the snapshot manifest, dropped at analysis and counted in the result header.

## 5. Estimands and estimators
Within a mailbox, a labeled **positive is clustered by its hiring process** (the labeled opportunity); every other message by its thread. One process spans many threads (in the held-out run 5 of 7 positives were one employer's process), so thread-only clustering would overstate the evidence.
- **Strict end-to-end recall:** v2 state `recruiting` over all labeled positives, S2 positives weighted 4. **Review counts as not found.**
- **Improvement:** paired weighted difference, v2 strict recall minus the current product's (found = keyword query matched AND rules said recruiting), stratified cluster bootstrap by mailbox.
- **Precision:** labeled-positive among rows with state `recruiting`. **Review rows are excluded** (neither true nor false positives).
- **Event-type accuracy:** among labeled positives v2 called recruiting whose label type is known, the share whose final type equals the labeled type in the reader taxonomy (conditional, so it does not double-count recall).
- **Agreement-region error:** among S1 rows the model read where the readers agreed (state not review), the share the label contradicts.
- **Review rate:** review rows over S1 rows the model read.
- **Ungrounded values:** the sum, over every model read, of structured values the independent grounding audit could not trace to the redacted input. An unaudited read counts as one.

## 6. Primary claims and decision rules
All seven must hold for "supported".
| # | Claim | SUPPORTED when | NOT SUPPORTED when | otherwise |
|---|---|---|---|---|
| 1 | Strict recall improves on the current product (paired) | lower 95% bound of the difference > 0 | point difference <= 0 | inconclusive |
| 2 | Absolute strict end-to-end recall | point >= 80% and lower bound >= 70% | point < 80% | inconclusive |
| 3 | Precision of v2 recruiting decisions | point >= 80% and lower bound >= 70% | point < 80% | inconclusive |
| 4 | Event-type accuracy | point >= 80% and lower bound >= 70% | point < 80% | inconclusive |
| 5 | Error when the two readers agree | point <= 2% and upper bound <= 4% | point > 2% | inconclusive |
| 6 | Review rate | point <= 8% and upper bound <= 12% | point > 8% | inconclusive |
| 7 | Ungrounded structured values | count = 0 | any value > 0 | inconclusive only if there are no reads |
The review upper bound of 12% is the predeclared margin: review is an operational burden, not a safety property, and 12% means at worst about one message in eight needs a person.

**Overall outcome (fixed in advance):**
- **NOT SUPPORTED** if any claim that has its required evidence (section 7) fails its point target: the conjunction is already broken.
- **SUPPORTED** only if every claim has its required evidence and is supported.
- **INCONCLUSIVE** otherwise: some claim lacks the evidence, or its point passes but its interval does not clear. A claim without its required evidence has a descriptive verdict only.

## 7. Minimum evidence and timing
Derived by an explicit power and precision analysis (`docs/prospective-power-analysis.md`, reproducible with `npm run shadow -- power`), powered at 80% against a good system (true rate 0.90 for recall, precision and type; true agreement error 1%; true review rate 5%; a paired gap of 18 points), using the analysis code's own decision functions and the thread/opportunity-clustered, weight-adjusted effective size. Required, per claim, as effective sample size measured at analysis time:
| Claim | Minimum |
|---|---|
| 1 and 2 (recall, improvement) | 45 effective positives |
| 3 (precision) | 35 effective decisions |
| 4 (event type) | 35 effective type decisions |
| 5 (agreement error) | 253 agreement-region rows |
| 6 (review rate) | 148 model reads |
| 7 (ungrounded) | at least one audited model read |
- The analysis (`npm run shadow -- analyze`) runs **once**. It refuses before the cutoff plus 8 weeks, and before then it shows no performance figure at all. At or after 8 weeks it still refuses (printing only effective sample sizes) until every claim has its minimum, unless the hard stop has been reached.
- At the hard stop it runs with whatever evidence exists, over mail that arrived before the eligible-through instant (leaving 14 days to read and label). **Missing evidence makes the outcome inconclusive; the bar is never lowered, and there is no extension.**
- It also refuses unless: the working tree's `lib/recruiting` and `lib/opportunities` equal the freeze tag's; every selected message is labeled; every dataset has a frozen audit list; every planned model read exists and was audited; the legacy-query flag is recorded for every row; and a result does not already exist.

## 8. Secondary measures and sensitivity (reported, never decisive)
Decided recall (review excluded), candidate recall (the stage the earlier held-out run could not see), the current product's recall, unconditional type accuracy, employer accuracy (normalized match), role accuracy, review by reason, per-mailbox recall and precision, and cost (model reads per 100 eligible messages, with non-sampled mail estimated from the arm). **Sensitivity analyses** (precision if review were resolved by the model's suggestion, strict recall if review were resolved by the suggestion, precision if every review row counted as positive) are computed in a structure the decision logic never reads: they cannot determine pass or fail (test-enforced).

## 9. Integrity controls and where they are enforced
| Control | Enforced by |
|---|---|
| Cohort cannot disagree with the cutoff | frozen constant; database CHECK; row re-validation at selection and analysis |
| Label set independent of reader output | typed ingestion-only selector; 11-column query; throwing-proxy and permutation tests |
| System statements immutable | write-once ingestion; first-read-wins model read |
| Code under test is the frozen code | analysis compares `lib/recruiting` and `lib/opportunities` trees with the tag |
| Fixtures never counted as evidence | `SYNTH-` ids; the analysis rejects them; the synthetic run rejects real rows |
| No pipeline output shown | product sync locked; collection through the CLI; reports are counts only until the analysis |
| One analysis | result file refuses overwrite; written read-only with its SHA-256 |
| No lowered bars | evidence minima in code; hard stop yields inconclusive |
| Raw bodies stay local | bodies live in memory during collection and in the private eval store for labeling; the shadow table has no text column; only redacted excerpts reach a worker, in a temporary directory deleted after import |
Any change to any frozen parameter or to `lib/recruiting` restarts with a new tag and a new window; earlier rows become development evidence.

## 10. Tooling (`npm run shadow -- <command>`)
`collect [--dry-run]`, `export`, `import`, `report`, `review`, `status` (counts only), `label-set`, `analyze`, `synthetic-run` (the whole workflow on fixtures, no real evidence consumed), `power`, `freeze-check`.

**Dress rehearsal (2026-11-08, before the freeze).** The label-set builder, label import, audit step and the analysis were run through their real code paths against a throwaway database whose name starts with `scratch_` (since dropped), loaded with 100 real development-mailbox shadow rows re-dated into the window inside that database only, and with plumbing-only labels (not evidence). Each refusal gate was triggered in turn (too early, evidence short, unlabeled message, missing model read, unrecorded legacy flag, missing audit list), the hard-stop run produced an inconclusive read-only result, and a second run refused. The rehearsal found and fixed three defects the synthetic run could not (the account identifier appeared in the per-mailbox breakdown; two header lines claimed checks that had not been made). A clock and tag-check override exists only behind a `scratch_` database name and is never used by `freeze-check`; the real database held zero prospective rows and zero label datasets throughout.

## 11. Expected feasibility, stated before the freeze
At a combined positive prevalence near 3.8% (the volume-weighted blend of the two mailboxes' historical rates) the expected number of effective positives by the end of the eligible window is about 30 if hiring-process clustering is as strong as the planning assumption and about 46 if it is mild, against a requirement of 45. It is reached comfortably only at prevalence of roughly 6.5% or more. **The most likely single outcome is therefore "inconclusive for insufficient evidence on the recall claims", not a verdict.** The protocol does not lower the bar to avoid that. Claims that reach their own minimum (precision, type, agreement error, review rate, ungrounded) are still decided and can still make the whole outcome "not supported".

## 12. Freeze procedure
1. `npm run shadow -- freeze-check` must print `ALL PRECONDITIONS SATISFIED`. It verifies mechanically: clean working tree; HEAD pushed; tag absent; tag deadline and the 7-day gap; frozen versions equal the code's; this document states every frozen parameter and is not marked provisional; minimum evidence equals the recomputed power analysis; product sync locked; the database constraint exists; no prospective rows and no prospective datasets exist; the synthetic workflow behaves (a good system is supported, a poor one is not, the label set is independent of reader behavior).
2. Create the annotated freeze tag named in section 1 on that commit, with the `lib/recruiting` and `lib/opportunities` tree hashes and the supersession note (section 13) in its message, and push it.
3. From the cutoff, run `collect` for each mailbox on the section 3 schedule.

## 13. Freeze history
- **`arch-v2-shadow-candidate-1`** (commit `aa9c0c0a3da2cfbd7d2654cf4f77b1c83e7fabcd`, 2026-11-08) was **superseded the same day, before any prospective evidence existed**: the database held zero prospective rows and zero prospective label datasets, and the window opens at the cutoff in section 1.
- Why: a freeze-integrity audit found inconsistencies inside the frozen tree. A test fixture still carried a competing cutoff and a competing sampling rate; the status line misdescribed how the tag is created; and the consistency test only checked that strings appeared somewhere in this document rather than binding each table row to its constant.
- What changed: test fixtures (now derived from the canonical constants), this document's wording and its history, the tag name, a supersession record in `frozen.ts`, and row-by-row consistency tests. **Nothing else changed:** not the architecture, thresholds, statistics, sampling design, cutoff, evidence minima, or privacy policy.
- candidate-1 remains in the repository as an immutable record and is never used: the analysis compares the code with the tag named in section 1 only.
