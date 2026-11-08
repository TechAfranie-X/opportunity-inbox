# blind-1-amended: official result

Date: 2026-11-08. Protocol: `docs/blind-1-preregistration.md` as amended by `docs/blind-1-amendment.md`. Aggregates only; no email content, senders, names or message ids.

**Formal pre-registered result: FAIL.** Bars 2 (recall), 3 (F1) and 4 (event type) are below threshold on point estimates, and all bars had to hold.
**Statistical confidence: low.** There are only 7 recruiting-positive messages (in 3 opportunities; 5 of the 7 are one employer's onboarding mail). This result does not validate the candidate and does not strongly refute it. Do not cite it as strong validation.

This is not a pristine BLIND evaluation. See Disclosures.

## What was run (once)
| Component | Value |
|---|---|
| Rules | `rules-baseline-2026.11.2-evidence` |
| Reader | `reader-s1-ga5cc64879982` (guide v2), run A, single run |
| Gate | G1-process (74 of 600 messages reached the model) |
| Reconciliation / verification / redaction / policy | as frozen; `lib/recruiting` tree `f4a966b`, `lib/opportunities` tree `a68b37d`, both unchanged |
| Dataset | `blind-1-amended`: 600 uniform from a 3,587-message, 365-day universe; manifest hash `a2e3e34d623c73f2…` |
| Ground truth | 600 usable items: 7 recruiting-positive, 593 recruiting-negative, 0 unusable (after the pre-registered audit, below) |
| Model access | two Haiku workers (60 and 14 messages), one attempt each, no retries; all 74 outputs parsed and verified |

Raw report (read-only, local): `blind-1-amended.OFFICIAL-result.txt`, sha256 prefix `0fbfe3a105aad259`. The result was recorded before any individual failure was inspected.

## Pass bars (reconciled, confident region; Wilson 95%)
| # | Bar | Result | Point | 95% interval | Interval clears bar |
|---|---|---|---|---|---|
| 1 | Precision >= 80% | 1/1 | PASS | 20.7-100 | no |
| 2 | Recall >= 80% | 1/3 | **FAIL** | 6.1-79.2 | no (entirely below) |
| 3 | F1 >= 0.85 | 0.50 | **FAIL** | bootstrap 0-100 | no |
| 4 | Event type >= 80% | 5/7 (71.4%) | **FAIL** | 35.9-91.8 | no |
| 5 | Company, normalized >= 80% | 5/6 (83.3%) | PASS | 43.6-97.0 | no |
| 6 | Role >= 70% | 7/7 | PASS | 64.6-100 | no |
| 7 | Error when readers agree <= 2% | 2/575 (0.3%) | PASS | 0.1-1.3 | yes |
| 8 | Review rate <= 8% | 25/600 (4.2%) | PASS | 2.8-6.1 | yes |
| 9 | Ungrounded values = 0 | 0 | PASS | | |

Only bars 7 and 8 have intervals that clear their thresholds. Bar 1 rests on a single true positive. Company exact accuracy: 4/6. Recall as defined by the report excludes the 4 positives routed to review; counting them as misses gives 1/7 (14.3%, interval 2.6-51.3%).

| Reader | TP / FP / FN / TN | Precision / recall / F1 | Type | Company (normalized) | Role |
|---|---|---|---|---|---|
| Rules only | 1 / 21 / 6 / 572 | 4.5% / 14.3% / 0.069 | 1/7 | 1/6 | 6/7 |
| Model only | 5 / 0 / 2 / 593 | 100% / 71.4% / 0.833 | 5/7 | 5/6 | 7/7 |
| Reconciled | 1 / 0 / 2 / 572 (+25 in review) | 100% / 33.3% / 0.500 | 5/7 | 5/6 | 7/7 |

Review: 25 of 600; the rules were wrong in all 25 (21 false positives, 4 true positives) and the model in none. Verification rejected two unparseable dates; 0 ungrounded values survived the independent re-audit. Gate G1-process recall 5/7. Grouping metrics are not measurable (the reader emits no grouping; one confident-region positive).

## Secondary sensitivity (non-decisional): excluding the 15 accidentally processed messages
3 of the 7 positives were among them, leaving 4. Reconciled recall 0/2; model-only recall 2/4 with no false positives; agreement-region error 2/567; review rate 18/585 (3.1%). Removing the exposed messages did not improve the result, so there is no sign the exposure helped. It did not and cannot affect pass or fail. Raw output: `blind-1-amended.sensitivity-excl-overlap.txt`.

## Failure analysis (after recording; no change made)
1. The rules did not generalize: 18 of the 21 false positives came from one education-program sender family (course and cohort mail the guide excludes as non-employment). 1 of 22 rules positives was correct (4.5%, interval about 1-22%).
2. The model produced 0 false positives across 593 negatives (95% upper bound about 0.6%).
3. Reconciliation takes the rules' answer when the readers disagree, so all 4 model-correct positives and all 21 rules false positives were routed to review. That is the main cause of the formal recall loss.
4. The two positives the gate dropped were background-screening and onboarding notices outside its "your application" phrasing; neither reader flagged them.

## Disclosures
- **Accidental-sync contamination.** The frozen rules ran on 133 message ids (126 threads) of this mailbox before labeling, through an unintended automatic first sync in the product; some rule outputs were briefly visible in the UI. The reader did not run and no labels existed. Containment and the decision to keep the uniform estimand are in `docs/blind-1-amendment.md`. Product sync stays locked (`BLIND_SETUP_LOCK=1`).
- **6 missing thread-context fetches.** Six Gmail rate-limit failures hit thread-context fetches, which fail silently to "no context"; up to 6 of 590 threads may have less context than production would give. All 600 members were fetched. Not repaired or refetched after freeze. The same snapshot fed labeling and prediction.
- **Self-names / redaction.** The reader strips the account holder's name from excerpts; the names are supplied at run time and the pre-registration does not fix them. For this run the account holder's three name tokens (first, middle, last) were passed via `--self-names` for export, import and report alike. Redaction changes the model input and therefore the reader cache key; the earlier development runs' name list is not recorded, so the development model and reconciled rows could not be reproduced for a regression check (the rules-only rows reproduced exactly).
- **Ground-truth audit.** The pre-registered audit reviewed all 8 positives, all unknown-field labels and a frozen seeded sample of 100 negatives, with predictions hidden. Three messages changed via appended superseding labels (original history preserved): two cannot-tell fields resolved to none-stated, and one positive reclassified to negative as post-hire paperwork rather than hiring. Before the audit there were 8 positives; after, 7.
- **Small positive count.** 7 positives, 3 opportunities, one employer for 5 of them. Intervals are wide; see the table.
- **Harness changes.** `scripts/reader-shadow.ts` gained `--datasets`, `--exclude-ids` and a `--bars` pass-bar block (plus an exact-company counter), made before any scored run. The existing metric definitions are unchanged. The candidate itself (`lib/recruiting`, `lib/opportunities`) is unchanged.
- **Consumed dataset.** blind-1-amended is spent. A changed candidate evaluated on it would be contaminated.

## Consequence
Return to targeted architecture work (reconciliation of disagreements, rules robustness to non-employment program mail, gate coverage for post-offer administrative mail), developed on development data, then evaluated on a new frozen candidate with a fresh held-out set that has far more positives (about 50 would need roughly 4,000 uniform messages at about 1% prevalence, or a pre-registered stratified design).
