# Architecture milestone 2: candidate generation, reading plan, and the disagreement problem

Date: 2026-11-08. Development data only (`dev-random-1`, `validation-1`, `validation-2`; 1,000 messages, 77 labeled recruiting). `blind-1-amended` was not loaded, rescored or used for tuning; the harness refuses non-development datasets. Aggregates only: no email content, senders or message ids.

**Read this first.** All numbers are on data the earlier system was fitted to, so they are optimistic for every design, including the frozen one. They support *which components to change and why*, not an accuracy claim. The next claim needs a new, pre-registered held-out evaluation (see Decisions).

## What the failed held-out run pointed at, and what development data says
| Weakness suspected | Evidence (development data unless stated) | Verdict |
|---|---|---|
| Candidate generation. The product fetches only mail matching a Gmail keyword query, capped at 200. | The query, emulated, would never fetch **19 of 77 positives (25%)**; end-to-end recall of the frozen pipeline is **70.4%** against 95.5% at reader level. The pre-registered evaluation sampled the whole mailbox, so it could not see this stage. | **Largest loss. Fix.** |
| Gate. Selects on hiring vocabulary and on the rules saying yes. | With the model reading everything, the gate hid 0 positives on dev but also 4 model false positives, so dev cannot show its risk. On synthetic post-offer mail the frozen path sent **0 of 8** to a decision; reading every candidate sent 8 of 8. | **Replace with veto-only triage.** |
| Rules over-fire on unfamiliar sender families. | Held-out run: 18 of 21 rules false positives from one sender family. Dev: rules are the better reader on average (F1 0.893 vs 0.834 when the model reads everything). | Keep rules as a reader, **demote from gate and from tie-breaker**. |
| Reconciliation defers to rules. | The frozen reconcile does not defer: it sends disagreement to review. It scored best of every policy tried (below). | **Keep.** |
| Model is the stronger semantic reader. | Not on dev: model-only F1 0.834 vs rules 0.893. The readers' errors are mostly different cases: agreement-region error is 0.7%. | **Complementary, not ranked.** |
| Verification works. | 0 ungrounded structured values survive across 1,000 + 74 + 38 + 34 outputs. | **Keep unchanged.** |

## Designs compared (development data, pooled, all 1,000 messages)
Complete reference reads: the model read all 1,000 messages (671 new reads, same redacted procedure as before), so every gate and policy below is scored offline against the same outputs.

| Design | P | R | F1 | strict R (review = miss) | review | wrong decisions |
|---|---|---|---|---|---|---|
| Frozen, reader level (the pre-registered view) | 94.1 | 95.5 | 0.948 | 83.1 | 3.0% | 7 |
| **Frozen, end to end (keyword query, G1, reconcile)** | 92.6 | 70.4 | 0.800 | 64.9 | 1.2% | 25 |
| Rules decide | 86.6 | 92.2 | 0.893 | 92.2 | 0 | 17 |
| Model decides | 80.2 | 89.6 | 0.847 | 89.6 | 0 | 25 |
| Consensus; disagree resolved by model if certain | 89.0 | 95.6 | 0.922 | 84.4 | 2.9% | 11 |
| Consensus; disagree resolved by rules if confident | 78.9 | 92.2 | 0.850 | 92.2 | 0 | 25 |
| Adjudicator on disagreements (rejected) | 83.8 | 87.0 | 0.854 | 87.0 | 0.3% | 23 |
| **v2: Gmail-category candidates, veto triage, read all, consensus-and-review** | 94.0 | 94.0 | **0.940** | 81.8 | 3.4% | **8** |

v2 against the production-equivalent pipeline, same messages, paired: **13 positives confidently found only by v2, 0 only by the old path** (exact sign test p = 2.4e-4); **17 wrong decisions only the old path makes, 0 only v2** (p = 1.5e-5). Per dataset, v2 F1 is 1.000 / 0.925 / 0.903 (frozen end to end: 0.774 / 0.820 / 0.788). Strict recall is the weak spot (81.8%, interval about 72-89%): positives in review still need a human tap, though the model's suggestion is attached.

No forced-decision policy beat consensus-and-review on dev, and the two real datasets disagree about who is right in a disagreement (dev: rules right 18, model right 10; held-out: model right in all 25). With no stable winner, review is the honest answer.

## Rejected: a third-read adjudicator
Built, tested (17 tests) and run once with a prompt locked beforehand (`adjudicate.ts`, `resolve.ts`, marked as rejected experiments). On the 34 development messages that needed it it decided 30 and was right **12 times (40%)**, worse than leaving them in review. In 11 of the 12 right verdicts it sided with the language model, so it mostly echoed the first-pass reader instead of adding independent evidence. 7 of its 18 wrong verdicts were labeled-Yes programs or fellowships that its guide called non-employment, which exposed a scope conflict in the labels (see Decisions). On the synthetic stress set it resolved all 38 cases, but that set is circular (written against the same precedents) and the model alone also scored 38 of 38, so it cannot support adoption. It was not tuned after the run.

## Stress set (synthetic, not a validation set)
38 hand-written messages with fictional employers across five classes (`stress-set.ts`). Correct / wrong / in review:

| Class | Rules only | Model only | Frozen gate + consensus | v2 read-all + consensus |
|---|---|---|---|---|
| Program mail in hiring words (8, all not recruiting) | 3 / 5 / 0 | 8 / 0 / 0 | 3 / 0 / 5 | 3 / 0 / 5 |
| Post-offer completion steps (8, all recruiting) | 0 / 8 / 0 | 8 / 0 / 0 | 0 / 0 / 8 | 0 / 0 / 8 |
| Employed admin, marketing, controls (22) | 22 / 0 / 0 | 22 / 0 / 0 | 22 / 0 / 0 | 22 / 0 / 0 |

Consensus-and-review makes no wrong decision on these but defers all 13 contested cases to a person; reading everything makes the post-offer mail *reach* the model (the frozen gate sends 0 of 8), which is what the held-out failure needed. It does not make them decided.

## What changed in code
- `reader/triage.ts`: veto-only triage (commerce, order, security-code, digest mail with no hiring signal; broad protections; unfamiliar mail passes) and `CANDIDATE_QUERY_V2` (Gmail categories, no hiring words). Saves about 9% of reads over the category set with no dev recall loss; the main value is that security codes, orders and digests never leave the device.
- `reader/pipeline.ts`: `planRead(email)` (depends on the message alone, test-enforced) and `settle(plan, rules, model)` (vetoed = not recruiting; planned but unread = review; else the frozen consensus-and-review).
- `reader/gate.ts`: added the research-only `G-all`; existing gates unchanged.
- `reader/stress-set.ts`, `scripts/arch-lab.ts` (`npm run arch -- diagnose|policies|candidates|triage-eval|compare|paired|stress-compare|adj-wrong`), tests in `architecture.test.ts` (29 reader tests; 335 in the full suite, all passing).
- **Not wired into the product.** The product still syncs with the keyword query and the rules only. Reads per 1,000 messages: frozen G1 329, v2 555, current product fetch 105.

## Decisions needed (not made here)
1. **Privacy: widen what is fetched.** v2 candidates are about 60% of a mailbox (Primary and Updates), against about 10% today. Bodies stay local; only redacted excerpts would go to a model. Widening from 10% to 55-60% is a product and privacy decision.
2. **Model hosting.** The reader runs only through in-session workers. A production reader needs a model service: cost is small (roughly 1.1k tokens per message read) but it is a new paid dependency and a new data flow.
3. **Scope: do programs, fellowships, scholarships and courses count as opportunities?** Development labels count applications to programs and fellowships as recruiting; the held-out labeling treated course cohorts and scholarships as not. This inconsistency inflates disagreements and undermines both measurements.
4. **Next evaluation.** blind-1-amended is spent. A new candidate needs a fresh pre-registered held-out set with many more positives (about 50 needs roughly 4,000 uniform messages at about 1% prevalence, or a pre-registered stratified design), the scope in (3) fixed first, and the full pipeline including candidate generation scored end to end.

## Corrections to earlier disclosures
- `docs/blind-1-amended-result.md` said the development model outputs could not be reproduced. They can: the account holder's three name tokens (first, middle, last), passed as `--self-names`, reproduce the documented development numbers exactly (rules 86.6 / 92.2 / 0.893, model 82.9 / 88.3 / 0.855, reconciled 94.1 / 95.5 / 0.948). The harness change is therefore regression-checked.

## Limits
Development data is fitted data; the stress set is synthetic and circular; the keyword-query emulation ignores Gmail's stemming (true recall is somewhat higher, but the cap and the vocabulary dependence remain); Gmail category labels were fetched as metadata (ids and system labels only) for the development mailbox; one run of each model read; nothing here is a held-out result.
