# Prospective evaluation protocol for architecture v2

Status: **DRAFT. It becomes binding only when the owner confirms the claims and thresholds in section 6 and the freeze tag in section 1 exists.** After that, nothing below may change. Written 2026-11-08, before any prospective message exists.

Purpose: gather genuinely untouched evidence about architecture v2 without another Gmail account, by evaluating only mail that arrives after a fixed future cutoff. Historical mail (including both existing mailboxes' past) is spent: it was seen, labeled or fitted, and may not be used as evidence for v2.

What this can and cannot show: one person's two mailboxes, one season of mail, one frozen candidate. It can support or fail to support the claims in section 6 for this user. It cannot establish accuracy for other users, other seasons, or other candidates.

## 1. Freeze
Frozen at the annotated tag `arch-v2-shadow-candidate-1` (created by the owner, at least 7 days before the cutoff):
- Code: all of `lib/recruiting` (record `git rev-parse arch-v2-shadow-candidate-1:lib/recruiting` and `:lib/opportunities` in the tag message), including triage patterns, `CANDIDATE_QUERY_V2`, the frozen rules (`rules-baseline-2026.11.2-evidence`), verification and reconciliation.
- Reader: `reader-s1-gb56d5132a955` (guide v3), pipeline `arch-v2.0`, redaction behavior and the name tokens supplied through `READER_SELF_NAMES`.
- Sampling: `READER_V2_UNIFORM_RATE=0.10`, hash arm `uniform-arm-v1`.
Any change to any of these makes a new candidate and starts a new window. Rows carry `reader_version`, `pipeline_version` and `extractor_version`; rows from another version are excluded from this evaluation.

## 2. Cutoff and eligibility
- Cutoff: **2026-11-16T00:00:00Z** (move it later, never earlier, if the tag is created after 2026-11-09; once the tag exists it is fixed). Set as `READER_V2_CUTOFF` wherever collection runs.
- Eligible: a message in a connected mailbox whose Gmail arrival time is at or after the cutoff. Eligibility depends on arrival time only, not on when it was ingested, so collection lag cannot bias it. The cohort is written at first ingestion and never changed.
- Excluded: anything earlier, sent mail, spam, trash, drafts.

## 3. Collection (no pipeline output is ever shown)
- Product sync stays blocked (`BLIND_SETUP_LOCK=1`) for the whole window, so neither the old nor the new pipeline displays anything about eligible mail. Collection runs only through `npm run shadow -- collect` for each mailbox at least every 3 days. The owner does not open product pages for the window's mail before labeling it.
- Collection records, for each eligible message: candidate or not, legacy-keyword-query match, planned read or veto, the rules' reading, sampling arm. Messages the candidate query does not match are recorded only when in the arm (metadata only); keyword-only matches are recorded because the current product fetches them anyway.
- Model reads: `export`, worker, `import` within 7 days of arrival, one read per message, **first read wins** (enforced in the store). A failed or invalid worker output is not retried and not edited: it stands as recorded (an abstention or invalid status counts as the system's output).
- Rows are write-once for every ingestion field; no backfill edits.

## 4. What gets labeled (a function of ingestion facts only)
Stratum S1: every eligible message that is a v2 candidate and planned for a model read (a census, not a sample).
Stratum S2: every other eligible message (triage-vetoed candidates, keyword-only messages, non-candidates) **that is in the sampling arm** (10%, weight 10).
Because the label set is decided by `is_candidate`, `planned_read` and `uniform_arm`, all fixed at ingestion, it is independent of anything either reader or the model said, and labeling can start before any model read exists. Unlabeled S2 messages outside the arm are covered by the weights.

Labeling procedure:
- Scope: the fixed recruiting scope (guide v3 wording): employment, internship and contract hiring including pre-start completion steps; courses, scholarships, bootcamps, hackathons, generic programs and already-started-job administration are not recruiting. Fields as in earlier labeling (type, employer, role, stage, date, opportunity id, actionability).
- Isolation: the isolated labeler, which loads no prediction, extractor or model output (its import graph is test-enforced). Labels are never made from the product UI or from any report. Labeler tag opaque, as before.
- Timing: label within 14 days of arrival, in arrival order, before looking at any shadow report beyond counts of volume and progress.
- Audit before analysis, predictions still hidden: all positives, all unknown fields, and a frozen seeded random sample of 100 negatives; corrections are appended superseding rows, never edits.
- Unfetchable or deleted messages stay in the denominator as system errors only if the system had already made a decision on them; otherwise they are dropped and counted.

## 5. Estimands and estimators
All intervals are 95%. Thread-level (cluster) bootstrap, 10,000 resamples, fixed seed, because messages in one thread or opportunity are not independent. Wilson intervals for simple proportions.
- **Precision** of v2 "recruiting" decisions: labeled-positive among all rows with `state = recruiting` (all are in S1, so this is a census).
- **End-to-end recall (strict)**: v2 `recruiting` and labeled-positive, over all labeled-positive messages, S2 positives weighted by 10. Review counts as not found. A looser "decided" recall (review excluded) is reported beside it.
- **Candidate recall**: labeled-positive messages that are v2 candidates, same weighting. This is the stage the earlier held-out run could not see.
- **Current product (comparator, same messages)**: found if the keyword query matched and the rules said recruiting (stored at ingestion). Paired difference in end-to-end recall, v2 minus product, with the cluster bootstrap and an exact sign test on discordant messages.
- **Agreement-region error**: among S1 rows both readers read and agreed on, the share the labels contradict.
- **Review rate**: review rows over S1 rows planned for reading; also the split by reason.
- **Field accuracy** (type with the reader taxonomy, employer by normalized match, role), over labeled-positive rows v2 called recruiting.
- **Ungrounded structured values**: count surviving an independent re-audit rebuilt from the labeled messages' redacted inputs. Required 0.
- **Cost**: model reads per 100 eligible messages.

## 6. Claims and thresholds (PROPOSED; the owner confirms or edits these before the tag)
Primary claims, all must hold for "supported":
1. End-to-end strict recall of v2 exceeds the current product's, paired, with a lower bound above 0.
2. Precision of v2 recruiting decisions is at least 80% (point) with a Wilson lower bound of at least 70%.
3. Agreement-region error is at most 2% (upper bound at most 4%).
4. Review rate is at most 8% of messages the model read.
5. Zero ungrounded structured values.
Outcomes: **supported** (all five), **not supported** (any point estimate misses, or any bound crosses the wrong side by the stated margin), **inconclusive** (point estimates pass but an interval cannot separate the claim). Secondary measures (candidate recall, field accuracies, cost, per-mailbox consistency) are reported, not decisive.

## 7. When we look
- Allowed during the window: counts only (rows ingested, reads pending, labels done, volume). No accuracy, agreement or disagreement figures.
- One analysis, when both hold: at least 50 labeled-positive messages in S1 across the two mailboxes and at least 8 weeks since the cutoff. Hard stop 2027-03-15 regardless of counts. If the result is inconclusive, the window may be extended once, by at most 8 weeks, with no change to anything frozen.
- Expected volume (order of magnitude only, from the past year's mailbox sizes): roughly 100 to 120 eligible messages a week across both mailboxes, about 10 labels a day. Fifty S1 positives depends on the season's prevalence; at 1% it would take much longer than the hard stop, in which case the result is reported as inconclusive and the intervals say how far it can be pushed.

## 8. Integrity controls
- Write-once ingestion fields and first-read-wins model reads (store-enforced); the cutoff, arm and routing cannot depend on output.
- Labeled set independent of any reader's output (section 4).
- Isolated labeler; no product UI exposure for eligible mail; product sync locked.
- No code, prompt, pattern, threshold, rate or cutoff change after the tag. A change restarts with a new tag and a new window; earlier rows become development evidence.
- The final result is written once to a read-only file with its hash, and a report that lists every disclosure (collection gaps, failed worker outputs, unfetchable messages, any deviation from this protocol).
- Both mailboxes belong to the same person: results are for this user's mail and are not evidence about other users.

## 9. Tooling still to build (not part of the shadow milestone)
1. `shadow label-set`: build the weekly label snapshot from S1 plus the S2 arm into the private eval store, using only ingestion facts.
2. `shadow analyze`: the single analysis in section 5, reading labels and shadow rows, writing the read-only result file.
3. Optional: a counts-only status command that cannot print accuracy.

## 10. Owner checklist before this is binding
- Confirm or edit section 6.
- Create the annotated tag `arch-v2-shadow-candidate-1` on the commit that contains this protocol, recording the tree hashes in its message.
- Set `READER_V2_CUTOFF=2026-11-16T00:00:00Z` (or a later date at least 7 days after the tag), `READER_V2_UNIFORM_RATE=0.10`, `READER_SELF_NAMES`, and keep `BLIND_SETUP_LOCK=1`.
- Start `npm run shadow -- collect` for each mailbox on a schedule (at least every 3 days).
