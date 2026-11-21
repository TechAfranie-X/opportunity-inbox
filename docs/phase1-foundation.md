# Phase 1: frozen evaluation baseline, evidence ledger, shadow decision engine

Status: foundation built and verified. **No production decision has changed.** The new engine runs only in the evaluation harness, and (behind a default-off flag) records its evidence beside the product's pipeline. Phase 2 (application identity and lifecycle) has not been started and waits for acceptance.

Direction (decided by the owner, not reopened here): Gmail, then semantic extraction (local model plus deterministic facts), then a structured evidence ledger, then identity and a unified decision engine, then lifecycle reasoning, then Today, Pipeline and Review. Retained: the local Qwen model, Gmail ingestion, the lifecycle reducer, and the human-correction protections.

## 1. What was built, and what was not touched
| Built | Where |
|---|---|
| Frozen development fixtures with cached model readings, plus an adversarial fixture | `eval/dev/journeys-{J,K,L,M,N,X}.json`, `cache-*.json` (invented mail only; hashes pinned in the baseline) |
| Strict replay mode (no model call, no cache write, a missing scenario is an error) | `scripts/eval-journeys.ts --replay` |
| Regression gate with frozen baseline, tolerances and a pre-regression reference | `scripts/eval-gate.ts`, `eval/baseline.json`, `eval/reference-8ee0e95.json` |
| Gate made mandatory | `npm test` (`lib/eval/gate.test.ts`, positive and negative), `npm run eval:gate`, pre-commit hook (`npm run hooks:install`), rule in `AGENTS.md` |
| Typed evidence ledger | `lib/ledger/types.ts` (types and `parseLedger`), `build.ts`, `chunk.ts`, `store.ts` |
| Shadow decision engine | `lib/decision/config.ts`, `engine.ts`, `shadow.ts` |
| Side-by-side comparison | `scripts/eval-compare.ts`, `eval/compare-phase1.md` |
| Persistence | table `evidence_ledgers` (migration `0007`, additive), deletion wired into `deleteRecruitingData` |
| Corrected-row integrity check | `scripts/integrity-check.ts` (read-only) |

Not touched: the product's decision chain (`applyAssist`, refinement, identity, reducer), every stored event, prediction and correction, Gmail (still read-only), and the production default (`EVIDENCE_LEDGER` is off). The only edits to existing decision files are exports (`semanticEvent`, `ownProcessWording`, `ENDINGS`, `DECISIVE`, `asEventType`) and the eval harness; the gate confirmed identical behaviour.

## 2. The frozen baseline and the mandatory gate
- **What is frozen.** Six fixtures (1,081 messages, 199 journeys) and the model readings the local model produced for them, hashed in `eval/baseline.json`. Replaying them takes a few seconds and calls nothing.
- **Baseline.** The product's current pipeline (including the model-alone gate from c45c215) at commit `34dfb81`. **Reference.** The code at `8ee0e95`, before that gate, on the same data. The gap between the two is the regression the new engine has to close, and it is on record.
- **What it measures.** Recruiting precision and recall, type accuracy, identity (pair precision and recall, wrong merges, splits, merged opportunities, journeys not found), lifecycle (status, outcome, stage), next action, source evidence, contradictions flagged, false opportunities, missed applications, review burden (items, justified share, important items).
- **Rules.** Pooled: a rate may not fall by more than 1.0 point; a count may not grow by more than max(2, 10%). Per fixture: recall, status and outcome may not fall by more than 4 points. A fixture or cache whose hash differs invalidates the baseline (exit 2, never a silent pass). Rewriting the baseline is explicit (`--write-baseline`) and documented.
- **Proven to bite.** `lib/eval/gate.test.ts` checks both directions: the gate fails a drop in recall, status or outcome and growth in false opportunities, wrong merges, splits or review burden, and it exits 1 when run against the better pre-regression reference.
- **Honest limits.** J to N are contaminated (their failures were inspected). Fixture X was written by the engine's author from known failure modes, so it is a regression test for opposition handling, not a generalisation estimate. A fresh sealed fixture O stays outside the repository for release validation.

## 3. The evidence ledger
One ledger per message: an append-only list of typed claims. A claim has a source (rule, model, fact, person), a kind (recruiting yes/no, event type, employer, role, or a named deterministic fact), a value, a strength, and the model's evidence as a hash and offset. Nothing is overwritten: the rule reader's claim, the model's claim and a fact that contradicts both sit side by side, so disagreement is preserved information. A later reader version adds rows; earlier ones stay.

Privacy by construction. There is no body, quotation, prompt or raw-response column. `parseLedger` runs on every write and every read and rejects anything that is not an enumerated value, a fact name, a hash, or a short single-line employer or role (the same strings the events table already holds). Tests and the end-to-end journey assert that sample message text never appears in the ledger. Everything is keyed by account; the store filters on it; "delete my data" removes the account's ledgers and only theirs. All of this is verified in `scripts/e2e-sample.ts` (recorded, claims only, versioned, isolated per account, content-shaped data refused, deleted with the data).

Recording is flag-gated (`EVIDENCE_LEDGER=shadow`, default off) and failure-isolated: a ledger error loses only the record and never fails or alters a sync.

## 4. The shadow decision engine
`decide(ledger)` is a pure function that returns a verdict: the belief that the message is the reader's own recruiting process (log-odds from weighted claims, with the weights and thresholds in one documented config object), the winning event type with every alternative's weight, a state, a placement (pipeline, possible, none), whether an ending is verified or proposed, stable reason codes, and the claim ids it leaned on and weighed against.
- **Opposition is measured; lack of corroboration is not.** A confident, grounded, unopposed model reading is evidence. A promotion marker, a job-alert digest or a second reader's "no" is opposition, and the claim then stays visible as a question with the opposing claims named.
- **Proposed versus verified.** An ending (rejection or withdrawal) is verified when independent sources name that type (for example the model plus plain closure wording), proposed when one unopposed source does, and withheld when contested. Events carry `decision:<state>` and `terminal:<verified|proposed>` for later phases.
- **Nothing is deleted.** A rule-reader event is never removed by the shadow engine, only questioned.
- **A person's decision outweighs every automatic reading** (supported by the ledger and engine; see risk R4).

## 5. Side-by-side results (identical cached readings; full tables in `eval/compare-phase1.md`)
| pooled | reference 8ee0e95 | baseline (current) | shadow engine |
|---|---|---|---|
| recall | 95.3 | 90.7 | **95.3** |
| precision | 98.0 | 98.1 | 98.3 |
| status accuracy | 89.1 | 74.9 | **89.1** |
| outcome accuracy | 68.9 | 58.6 | **69.4** |
| stage accuracy | 75.5 | 66.3 | **76.0** |
| contradictions flagged | 63.3 | 46.7 | **63.3** |
| false opportunities (count) | 13 | 12 | **11** |
| missed applications (count) | 32 | 63 | **32** |
| wrong merges (count) | 71 | 64 | 71 |
| journeys split (count) | 33 | 28 | 33 |
| review justified share | 48.6 | 56.1 | 51.0 |

- The shadow engine recovers the pre-regression numbers without the destructive gate and slightly improves on them (a retyped event now carries the confidence of its new evidence; one extra false opportunity blocked). It was run before any tuning and nothing was fitted to a fixture.
- Message level: the two engines produce the same pipeline type on 938 messages; where they differ the shadow is right on 32 and the current pipeline on 9 (8 both wrong).
- Calibration of the belief is monotonic: 33% of messages below 0.35 are really recruiting, 56% in 0.35 to 0.8, 96% in 0.8 to 0.95, 99% above.
- Endings: **37/37 verified endings were correct; 37/47 proposed endings were (79%).** The distinction carries information, and the old gate would have discarded all 47, including those 37 real ones.
- Adversarial fixture X: the shadow engine keeps promotions, welcome notices and event promos out of the pipeline (contested or noise, with the opposing fact named) and keeps real mail the rules do not recognise. It still lets a vendor newsletter through as a false opportunity (nothing in the facts opposes it), and that is reported, not hidden.

Where the shadow engine is NOT better, and why it cannot yet be promoted: `eval-gate --engine shadow` fails four checks against the baseline (review justified share 56.1 to 51.0, missed links, journeys split, important items). These are the same values the pre-regression reference had: restoring the lost events restores their grouping and review burden. They belong to identity and review design (Phase 2), not to the decision layer. The promotion criterion should therefore be "no regression against the better of baseline and reference on every metric", to be fixed with the owner before Phase 2 ends.

## 6. Acceptance criteria
| Criterion | Evidence |
|---|---|
| Reproducible baseline and mandatory regression gate | `eval/baseline.json` (hash-pinned), `eval-gate.ts`, `gate.test.ts` in `npm test`, pre-commit hook, `AGENTS.md` rule |
| Functioning typed evidence ledger | `lib/ledger/*`; the ledger's privacy and validation rules are tested in `decision.test.ts` (shared with the engine), plus end-to-end persistence in keyword and sweep modes |
| Shadow engine, explainable and traceable | `lib/decision/*`, `decision.test.ts` (10 tests), verdicts with for/against claim ids, trace table in `eval/compare-phase1.md` |
| Side-by-side on identical cached data | `eval/compare-phase1.md` (section 5 above) |
| No destructive change | additive migration `0007` only; `integrity-check compare` OK (139 corrected rows untouched); row versions identical to the post-v6 snapshot; no Gmail write; no production decision changed |
| Tests, lint, typecheck, build | lint 0, `tsc` 0, 691 of 691 tests, build 0, lifecycle benchmark 0, e2e PASSED (keyword and sweep) |
| Migration strategy and remaining risks | sections 7 and 8 |

## 7. Migration strategy
Order matters: **apply migration `0007` before deploying this code to any database.** `deleteRecruitingData` now deletes ledger rows, so code without the table would fail a deletion. It was applied to the local development database (additive, existing data untouched: events, predictions and corrected rows unchanged).
1. Phase 1 (done): offline shadow, flag-gated recording, gate.
2. Phase 1.5 (optional, owner decision): set `EVIDENCE_LEDGER=shadow` so newly read mail on both accounts is recorded with the shadow verdict next to the production event. No re-read. Compare disagreement rates and have the owner label a small sample (message ids and labels only).
3. Phase 2: identity as attribution against the person's open applications (model chooses among candidates, ambiguity goes to Review, never a merge), a dedicated outcome reader (acceptance, withdrawal, expiry), a Review item when a person's confirmation disagrees with later text; all developed behind the same gate, plus a fresh sealed fixture O.
4. Phase 3: canary per account behind `DECISION_ENGINE=ledger` with rollback criteria (any gate regression, corrected-row change, review-burden jump). One re-read per account, recording the readings so later logic changes replay with no Gmail refetch.
5. Phase 4: retire the destructive gates and the old chain.
Rollback at every step: unset the flag; the ledger table is additive and independent.

## 8. Remaining technical risks
- **R1. Weights are set a priori.** They are not calibrated on real labelled data. The calibration table is good on fixtures that the author's generators shaped. Needs owner-labelled real samples.
- **R2. Fixtures share an author.** Development fixtures and X were written by the same process as the rules; blind spots are shared. Fixture O must be independent.
- **R3. Vendor newsletters and similar mass mail** with no marketing marker are false opportunities in both engines. Needs structural features (list-unsubscribe headers, bulk precedence, sender patterns); Gmail headers are not carried into `RecruitingEmail` today.
- **R4. Person claims are supported but not wired.** The sync does not yet pass stored corrections into the ledger, so settled verdicts occur only in tests. The corrected-row guard is unaffected.
- **R5. Ledger covers only new reads.** Messages read before the flag have no ledger; old mail gets one only on the one re-read in Phase 3. Held and deferred messages are not recorded in Phase 1.
- **R6. Identity is unchanged.** 71 wrong merges and 33 splits on the fixtures (same-employer multi-application cases) are untouched; the engine can only restore, not fix, them.
- **R7. Proposed endings are 79% precise.** They must be shown as "likely, please confirm", which needs a product change in Phase 2.
- **R8. Model reading gaps.** Some cached scenarios have messages the model never read; replays carry the same gaps.
- **R9. Storage growth.** One small row per message per reader version; acceptable now, to be pruned by policy if versions multiply.

## 9. Data-integrity issue: unresolved
Fifteen corrected rows were rewritten after the 01:11 snapshot on 2026-11-20 and before the post-v6 snapshots. It is NOT resolved and is not claimed to be. What is now known: 124 of the 139 corrected rows carry the two restore-transaction versions; the other 15 each carry their own later version (distinct statements); none of the 139 has changed since the 06:41 snapshot (checked again here, and `integrity-check compare` is clean). Two explanations fit and the data cannot separate them: a sync worker still running pre-guard code (the guard was committed at 01:06 and a resync log was still being written at 01:14), or per-row actions through the application. New: `scripts/integrity-check.ts` snapshots and compares id, row version and a content digest for every corrected row (read-only, no content printed); run it before and after every re-read or release. Recommended, needing approval because it touches a production write path: a database trigger that appends an audit row whenever a corrected row is updated, naming the session, which would identify the writer next time.
