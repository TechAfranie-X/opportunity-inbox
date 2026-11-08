# Prospective evaluation: power and precision analysis

Date: 2026-11-08, before any prospective message exists. Reproduce every table with `npm run shadow -- power`; a unit test recomputes the frozen minimum-evidence numbers from the analysis code and fails if they drift (`lib/recruiting/shadow/power.test.ts`). Nothing here uses prospective data. Historical mail was used only for engineering inputs (thread structure, plausible effect sizes), never as accuracy evidence.

## Question
How much evidence must exist before the single analysis may run, so that a good system can actually be shown to be good, and so that thread/opportunity clustering and the S1/S2 design are accounted for rather than ignored?

## Method
1. **Decision functions are the analysis code.** Each claim is decided by `atLeast`, `atMost` or `improves` in `stats.ts`, fed by the same interval procedure the final analysis uses.
2. **Intervals live on an effective sample size.** Observations are collapsed to hiring-process (positives) or thread (everything else) totals within a mailbox; the effective size is the Kish size of those totals, `(sum W)^2 / sum W^2`, which falls both with clustering and with unequal weights (S1 weight 1, sampled S2 weight 4). The interval is Wilson at that size. This assumes perfect correlation inside a cluster, the worst case, so it is conservative: real data with weaker correlation does better than these tables say.
3. **Power is therefore exact binomial.** For a proportion claim, the chance of "supported" at effective size `n` and true rate `p` is the sum of binomial probabilities over outcomes with point >= target and lower bound >= floor. No simulation noise.
4. **The improvement claim has no closed form.** Its power is simulated with the real stratified cluster bootstrap (300 replications of 400 resamples, fixed seeds) under a paired design truth.
5. **Minimum n requires power to hold.** Power is not monotone for discrete data, so the requirement is the smallest n whose power reaches 80% and stays there for the following 25 sizes (improvement: the next two multiples of 5).

## Design truths (frozen in `frozen.ts`, `powerDesign`)
- Power target: 80%.
- Each "at least" claim (recall, precision, event type): true rate 0.90. A system whose true rate is 0.90 is declared supported at least 80% of the time at the frozen minimum.
- Agreement-region error: true 1%. Review rate: true 5%.
- Paired table for the improvement claim, as shares of positives: found by v2 only 0.20, by the current product only 0.02, by both 0.60, by neither 0.18. That is v2 strict recall 0.80 against 0.62, a gain of 18 points: smaller than the 17 to 24 points seen on historical development data, to avoid powering against an optimistic gap.

## Results (generated)
## Minimum evidence (recomputed from the frozen design: 80% power at true rate 0.9, agreement error 1%, review 5%)

| Claim | Effective n needed | Frozen value |
|---|---|---|
| Strict recall and improvement (positives) | 45 (recall alone 35, improvement alone 45) | 45 |
| Precision (v2 recruiting decisions) | 35 | 35 |
| Event-type accuracy | 35 | 35 |
| Agreement-region error | 253 | 253 |
| Review rate | 148 | 148 |

## Chance a claim is declared SUPPORTED, by true rate (rule: point >= 80% and lower bound >= 70%)

| Effective n | true 70% | true 75% | true 80% | true 85% | true 90% | true 95% |
|---|---|---|---|---|---|---|
| 35 | 0.03 | 0.10 | 0.27 | 0.57 | 0.87 | 0.99 |
| 45 | 0.02 | 0.09 | 0.30 | 0.64 | 0.92 | 1.00 |
| 70 | 0.02 | 0.13 | 0.45 | 0.84 | 0.99 | 1.00 |
| 150 | 0.00 | 0.09 | 0.55 | 0.96 | 1.00 | 1.00 |
| 400 | 0.00 | 0.01 | 0.53 | 1.00 | 1.00 | 1.00 |

## Effective n for 80% power by true rate (at-least claims)

| True rate | 0.95 | 0.9 | 0.85 | 0.82 |
|---|---|---|---|---|
| Effective n | 21 | 35 | 69 | 285 |

## Chance of 'supported' for the two ceilings, by effective n

| n | agreement error true 0.5% | 1% | 1.5% | review true 3% | 5% | 7% |
|---|---|---|---|---|---|---|
| 100 | 0.61 | 0.37 | 0.22 | 0.92 | 0.62 | 0.29 |
| 150 | 0.83 | 0.56 | 0.34 | 0.99 | 0.87 | 0.52 |
| 253 | 0.99 | 0.89 | 0.67 | 1.00 | 0.98 | 0.76 |
| 400 | 1.00 | 0.98 | 0.85 | 1.00 | 1.00 | 0.81 |

## Will the evidence arrive by the hard stop? (planning assumptions: 117 eligible messages a week across both mailboxes, 14.9 weeks of eligible mail; "effective share" is the effective sample as a fraction of the positive count, lowered by hiring-process clustering)

Expected effective positives by the end of the eligible window (requirement 45):

| Positive prevalence | effective share 0.3 | effective share 0.45 | effective share 0.7 |
|---|---|---|---|
| 1.0% | 5 (short) | 8 (short) | 12 (short) |
| 2.0% | 10 (short) | 16 (short) | 24 (short) |
| 3.0% | 16 (short) | 23 (short) | 36 (short) |
| 3.8% | 20 (short) | 30 (short) | 46 (reaches) |
| 5.0% | 26 (short) | 39 (short) | 60 (reaches) |
| 6.5% | 34 (short) | 50 (reaches) | 79 (reaches) |
| 8.0% | 41 (short) | 62 (reaches) | 97 (reaches) |
| 10.0% | 52 (reaches) | 78 (reaches) | 121 (reaches) |


## What the numbers mean
- **Binding requirement: 45 effective positives.** The improvement claim needs more evidence than the absolute recall claim (45 against 35). Precision and event type need 35 effective decisions each, which follow automatically once about 45 positives exist.
- **Ceilings are cheap.** Agreement error needs 253 agreement-region rows and review rate 148 model reads; the census reaches those within weeks.
- **False support is controlled at the floor.** A system whose true rate is exactly the 70% floor is declared supported about 2 to 3% of the time at any sample size (and far less with more data); this is the 95% interval doing its job. A system at the 80% target is supported only about half the time at large samples, and 30% at the frozen minimum: the convention requires the interval to clear 70%, not merely the point to clear 80%. A clearly good system (90%) is supported 92% of the time at the minimum.
- **The true bar is therefore "credibly good", not "possibly good".** That is intended.

## Will the evidence arrive?
It may not, and that is stated here, before the freeze. With the planning assumptions listed above the expected number of effective positives by the end of the eligible window is below the requirement at most plausible prevalences. Two assumptions drive it and both are uncertain:
1. **Prevalence.** The two mailboxes' historical rates differ sharply (about 8% in the development mailbox, about 1% in the held-out one); weighting by message volume gives a central planning figure near 3.8%. Seasonality is unknown.
2. **Clustering.** Development labels place 77 positives in 65 hiring processes inside a 29% sample, which implies larger clusters in a census; the held-out sample had 5 of 7 positives in one process. The effective share of 0.45 is a central guess; the table shows 0.3 and 0.7.
At the central prevalence the requirement is reached only if clustering is mild. **If the requirement is not reached by the hard stop, the outcome is "inconclusive", not a lowered bar** (protocol section 7). Per-claim verdicts for claims that did reach their own requirement are still reported, and a claim that reached its requirement and missed its point target makes the whole conjunction "not supported".

## Limits of this analysis
- Design truths are choices, not measurements. The tables show other true rates so the choice is visible.
- The perfect-correlation assumption makes the effective sizes, and therefore the requirements, conservative.
- The gate uses MEASURED effective sizes at analysis time; the planning assumptions only affect the expected timeline.
- The weekly volume (117 eligible messages across both mailboxes) is estimated from the past year's mailbox sizes.
