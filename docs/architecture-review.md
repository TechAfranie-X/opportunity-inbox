# Architecture review: why the reader got worse, and what to build instead

Date: 2026-11-20. Scope: investigation only. No product code was changed, no mailbox was re-read, no model was run (every number below is a replay of cached model readings). Code under test was checked out in a throwaway git worktree, with one-line ablations applied there and never committed.

## 1. Verdict in one paragraph
The hybrid design (rules plus a local model that reads mail, a verification layer, identity resolution, an event-sourced lifecycle reducer) is sound and should be kept. The regression is not a mystery and not architectural drift in the model: it is one commit (`c45c215`) whose three "corroboration gates" delete correct model evidence, and it was shipped without running five replayable fixtures that would have caught it in under a second. Behind that sits a real architectural weakness: evidence is decided by a chain of sequential, destructive gates over string-tagged events, so every new guard trades recall for precision with no way to weigh the two. Second, identity resolution is feature-starved for the multi-application case, which no threshold can fix. Third, every logic change forces a multi-hour Gmail re-read because nothing replayable is stored. Recommendation: retain the skeleton and the reducer, redesign the decision layer between reading and lifecycle (evidence ledger, proposed versus settled outcomes, model-assisted attribution against candidate applications), and decouple reading from deciding so future changes are replayed in seconds.

## 2. What was measured

### 2.1 Bisect with identical model output (fixture N, baseline cache)
Each row is the code at that commit, replayed on the same cached model readings (rules and verification differ; the model output does not).

| Commit | Change | Recall | Status | Outcome | Stage |
|---|---|---|---|---|---|
| 5230fa9 | baseline | 93.4 | 89.2 | 59.5 | 70.3 |
| 13ecca3 to 62e9606 | closure wording, routing, integrity, buckets, event kinds | 93.4 | 89.2 | 59.5 | 73.0 |
| 5494580 | retraction joins its process | 93.4 | 86.5 | 59.5 | 70.3 |
| d8e2f2a | receipts named candidacies | 92.7 | 86.5 | 59.5 | 70.3 |
| 79a7fc7 to 8ee0e95 | membership/welcome veto, bulk footers | 92.7 | 86.5 | 59.5 | 70.3 |
| **c45c215** | **model alone never ends a candidacy** | **86.1** | **66.7** | **44.4** | **63.9** |

Running it with the cache produced by the current code instead gives the same cliff at the same commit (91.4 to 84.8 recall, 86.5 to 66.7 status). So the model output is not the cause; the downstream code is.

### 2.2 The same cliff on four older fixtures (J, K, L, M), replayed
| Fixture | Recall before to after c45c215 | Status | Outcome |
|---|---|---|---|
| M | 97.0 to 90.2 | 93.0 to 80.7 | 71.9 to 64.9 |
| L | 96.5 to 95.1 | 82.4 to 76.5 | 61.8 to 58.8 |
| K | 96.1 to 91.3 | 88.2 to 66.7 | 70.6 to 51.5 |
| J | 95.7 to 92.3 | 92.3 to 76.9 | 80.8 to 69.2 |

Five fixtures, two caches, one direction. The older fixtures were available the whole time.

### 2.3 Which part of c45c215
c45c215 contains three places that require plain-text closure wording before a model-found rejection counts (A: near-miss path, B: retyping a generic event, C: model-only events), plus a new subject veto and a wider invitation regex.

| Variant (all on identical readings) | Fixture N status / outcome | Fixture K status / outcome |
|---|---|---|
| full c45c215 | 66.7 / 44.4 | 66.7 / 51.5 |
| A off | 66.7 / 44.4 | 66.7 / 51.5 |
| B off | 66.7 / 44.4 | 75.8 / 57.6 |
| **C off** | **86.5 / 59.5** | 79.4 / 64.7 |
| **B and C off** | **86.5 / 59.5** | **88.2 / 70.6** |
| A, B, C off (veto and regex kept) | 86.5 / 59.5 | 88.2 / 70.6 |

With B and C off, every fixture returns to its pre-regression numbers. The `assist` unit tests (six) pass with all three gates off: the tests I wrote for the commit never exercised the gates, so nothing was protecting them or proving they were needed.

### 2.4 What the gate does, measured against ground truth
Model readings of "rejection, high certainty" across the five fixtures (74 in total):

| | Plain closure wording found | Not found |
|---|---|---|
| Truly a rejection | 25 | **37** (blocked) |
| Recruiting but a different type | 0 | 12 |
| Not recruiting mail (promo, welcome, vendor) | 0 | **0** |

The gate lets through 40% of real model-found rejections and blocks 60% of them. The case it was written for (a promo read as a rejection) appears zero times in the fixtures, so the fixtures can only show its cost, never its benefit. Separately, the subject-based veto and wider regex already handle the promo that motivated it (unit tests pass without the gates), and the real accounts still gained roughly 100 single-event model-only records after c45c215, so the gate did not control that noise either.

### 2.5 How much the model matters
At the pre-regression code, rules only against hybrid:

| Fixture | Rules recall | Hybrid recall | Hybrid precision cost | Status rules to hybrid |
|---|---|---|---|---|
| N | 59.6 | 92.7 | 0.0 | 76.2 to 86.5 |
| M | 46.6 | 97.0 | 2.3 | 79.4 to 93.0 |
| L | 75.0 | 96.5 | 1.4 | 84.6 to 82.4 |
| K | 66.9 | 96.1 | 2.4 | 70.8 to 88.2 |
| J | 55.6 | 95.7 | 1.8 | 66.7 to 92.3 |

A 4-billion-parameter local model adds 20 to 50 points of recall for under 2.5 points of precision. Weak model reasoning is not the problem; discarding what it finds is.

### 2.6 Identity resolution: the limit is features, not thresholds
Wrong merges at the pre-regression code: N 25, K 25, L 14, J 5, M 2. On N they are three scenarios with the same structure: two or three simultaneous applications to one employer, same sender, identical or generic subject lines ("Thanks for applying", "Next steps"), told apart only by team or role in the body.

A sensitivity test of the generic-link time window (90, 45, 21, 7 days):

| Window | N wrong merges | N pair recall | M pair recall |
|---|---|---|---|
| 90 d | 25 | 96.0 | 87.4 |
| 21 d | 25 | 96.0 | 36.1 |
| 7 d | 12 | 97.1 | **11.8** |

Tightening the window halves N's merges and destroys M's links. A parameter that only moves error between fixtures is a sign that the information to separate them is missing.

### 2.7 Lifecycle on fixture N (baseline hybrid) by mismatch type
Offer recorded but acceptance missed (5 journeys); closure missed or attributed to the wrong application among same-employer applications (5); withdrawals read as rejections or offers (3); offers left unresolved (3). The reducer itself is 85 lines, monotonic in stage, with status and closure reason separate, and the repo's lifecycle benchmark passes 57 of 57. Its errors come from event typing and attribution upstream, not from its logic. Caveat: that benchmark is hand-built by us, and I did not build an independent oracle harness.

### 2.8 Coupling and provenance
The read-to-lifecycle path is about 2,570 non-test lines. Event type, confidence and provenance are mutated in sequence by `applyFacts`, `applyAssist`, `reconcileReadings`, `refineEvents` and the history layer, using about 100 string-tag manipulations on a free-form `signals` array (13 distinct `semantic:`/`rule:` tags). A gate in one stage deletes evidence that later stages never see, so a local fix has non-local effects; that is why a "guard" for one real-mailbox case moved five fixtures.

## 3. Diagnosis against the question asked
- Overly restrictive rules: yes, one change. Corroboration gates that require plain wording before trusting the model discard 60% of correct model rejections.
- Weak model reasoning: no. The model contributes 20 to 50 points of recall at low precision cost.
- Unreliable evidence attribution: yes, in the multi-application case. Same employer, same sender, same subject. No scalar tuning helps.
- Component interaction: yes. Sequential destructive stages over string-tagged signals, with no shared representation of "who said what, how sure, and what it was weighed against".
- Process failures that let it ship (mine): the replayable fixtures were not run before committing; my own code comment already said "requiring corroboration crushed recall on every fixture" for an earlier version of the same idea; the new test did not discriminate; and I only measured after about seven hours of re-reads, so the v6 stored state on both real accounts carries the regression until the next re-read.

## 4. Options
| Option | Verdict | Why |
|---|---|---|
| Keep adding guards in the current chain | Reject | Each guard is a hard delete with no cost model; the last one cost 20 points. |
| Rules-first, model as advisor | Reject | Rules-only recall is 47 to 75 on unfamiliar mail. |
| Model-only (hosted or local) end to end | Reject for now | Highest ceiling, but the local 4B model gives 65 to 80 on lifecycle without structure; hosted transmission is not authorised; loses auditable evidence. |
| Keep hybrid, redesign the decision layer | **Recommend** | Keeps the proven recall engine and reducer; fixes the coupling that caused the failure. |

## 5. Recommended architecture
Keep: Gmail read-only fetch, rule reader, local model reader, the reducer, the corrected-row guard, the append-only prediction history.

Change:
1. **Evidence ledger instead of mutate-and-veto.** Every reading becomes an immutable claim: source (rule, model, person, structure), claimed type, employer, requisition or role, date, certainty, evidence span reference. One decision function (the only place an event type is chosen) weighs claims. Today's gates become features in that function rather than deletions, so a missing plain-text corroboration lowers belief instead of erasing the claim.
2. **Proposed versus settled outcomes.** Because wrongly closing a live application and leaving a dead one open have different costs, a model-found terminal outcome without corroboration becomes "likely closed, please confirm" in the pipeline and Review, not silence and not an automatic close. A person's confirmation settles it, and a confirmation that disagrees with later text raises a Review item (the Alcon case) instead of overriding or being overridden.
3. **Attribution as a candidate-selection task.** For a message from an employer where the person has several open applications, give the model the list of candidate applications (employer, role, team, cycle, requisition, dates) and ask which one, none, or ambiguous. Rules veto only on hard conflicts (different cycle, different program). Ambiguity yields a Review item, never a merge. This addresses the 25 wrong merges at their source and also closure attribution.
4. **A dedicated outcome reader** for acceptance, withdrawal and expiry, anchored on the person's own replies and on structured offer wording, since "offer recorded, acceptance missed" is the largest lifecycle error class.
5. **Decouple reading from deciding.** Persist a derived, non-text reading record per message (model output fields, closure and bulk-mail booleans, grounding offsets; no body, no prompt). Then every future logic change is replayed over stored readings in seconds with no Gmail refetch and no model call. This needs an explicit owner decision because it changes what is retained; it contains no raw message text.

Remove: gating by string tags as the control mechanism; the time-window as the main identity lever.

## 6. Path to reliable tracking
1. Make fixture replay a required gate: all of J to N replayed from cached readings, with thresholds that fail a commit on any recall, status or outcome drop of more than two points. Runtime under a second (this is the tooling used here, scripts kept in the session scratchpad).
2. Close the evaluation gap: add the missing negative cases (promo read as a rejection, welcome and invitation mail, vendor mail, unsubscribe-bearing bulk mail) and more multi-application scenarios to a new fixture O; label a sample of real model-only events with the owner (message ids and labels only, no text).
3. Decide the retention question (5. above).
4. Implement the ledger and the decision function behind the existing interfaces, ablation-tested against J to N and the new fixture before it replaces anything.
5. Add model-assisted attribution and the outcome reader; measure wrong merges, closure attribution and acceptance separately.
6. One re-read per account, only after offline replay passes on fresh fixture O (run once, thresholds pre-registered).
Interim, if a fast mitigation is wanted before the redesign: reverting B and C restores the earlier numbers on all five fixtures. I did not do it (instruction: no patch), and it would reopen the Salesforce-style case only if the subject veto fails to catch it.

## 7. Limits and honesty
- Fixture N is now contaminated: I read its wrong-merge and lifecycle mismatch listings (all fictional data). Do not treat it as sealed. J to M were already inspected.
- All fixtures were written by the same generator logic as the product's rules, so they share blind spots; real-mailbox labelled data does not exist yet.
- Sample sizes are small (62 true model-found rejections across five fixtures). The direction is consistent across all five; the exact percentages are not precise.
- The reducer was not tested with an independent oracle.
- The real-account effect of the regression (how many closed applications currently appear open) was not measured because that would need a re-read or direct inspection of stored data, which this investigation excluded.
- Where fixtures show no promo-as-rejection case, the gate's benefit on real mail is unmeasured, not disproven.
