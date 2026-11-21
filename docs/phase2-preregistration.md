# Phase 2 pre-registration (written before any identity or lifecycle code and before fixture O is scored)

Date: 2026-11-20. Fixture O (10 scenarios, 55 messages, 15 journeys) was authored from the Phase 2 requirements list and sits OUTSIDE the repository (`~/.opportunity-inbox-sealed/journeys-O.json`, with a cache of model readings made by a script that scores nothing). Its decisions are scored ONCE, with the final Phase 2 code, in the engines below. Once its failures are inspected it is contaminated and is not used again as unseen evidence. It is small (15 journeys), so every percentage on it carries a wide interval and is reported with counts.

Honest limit: the fixture author is also the engineer. O is independent of the DESIGN (it was written before the design existed and is never used to tune), not independent of the author's idea of what recruiting mail looks like.

## What is compared on O
1. `current`: the product's present decision chain and identity (frozen baseline code).
2. `phase2`: the shadow decision engine plus the Phase 2 identity and lifecycle changes.
Same model readings for both. Each metric is evaluated separately (identity, lifecycle, grouping, missed links, false opportunities, review burden, correction preservation), never as one number.

## Thresholds for `phase2` on O (a miss is reported as a miss; nothing is re-run or relaxed)
| Area | Measure | Threshold |
|---|---|---|
| Discovery | recruiting recall | >= 90% |
| Discovery | false opportunities (of 6 mass-mail messages in o9 plus the forwarded copy in o4) | <= 1 |
| Identity | wrong merges (message pairs) | <= 2 |
| Identity | opportunities merging two journeys | <= 1 |
| Identity | journeys split across opportunities | <= 1 |
| Identity | journeys not found | 0 |
| Lifecycle | status accuracy | >= 85% (13 of 15) |
| Lifecycle | outcome accuracy | >= 75% |
| Lifecycle | stage accuracy | >= 75% |
| Dormancy | the quiet application (o7) stays active; never inferred closed | 100% |
| Review | unnecessary items among all items | <= 50% |
| Correction preservation | any change to a corrected, confirmed or ignored event or to a person's link constraint | 0 (unit and property tests, plus the end-to-end journey) |

## Release gate (restated, not changed)
`eval-gate --against best` compares the shadow engine with the element-wise BEST of the frozen baseline and the pre-regression reference on the development fixtures: every higher-is-better metric must be at least as good minus the existing tolerance, every count no worse plus the existing tolerance. It is added NEXT TO the existing baseline gate, which is unchanged. The existing gate and tolerances are not weakened.

## Trade-offs to be reported, not hidden
Recovering missed opportunities (recall) raises the number of events that can be wrongly grouped; an ambiguity that cannot be resolved from evidence becomes a Review question instead of a guess, which lowers false merges and raises review burden. Each Phase 2 change is reported with its effect on recall, false opportunities, wrong merges, splits and review items together.

## Amendment (2026-11-21), written BEFORE the mechanisms below were implemented and before fixture P is scored
Fixture O was scored once (results in `docs/phase2-identity-lifecycle.md`). It met 10 of 11 thresholds and missed "journeys split" (4 against a limit of 1). The failure lines were then inspected (journey keys only), so **O is contaminated** and is not used again as unseen evidence. The inspection showed four causes: an employer written in a short and a long form ("Corvid" / "Corvid Systems"), an agency naming the employer only in the body, a confirmation of the student's own withdrawal that identity treated as a new application, and a self-forwarded copy that I had authored as inbound although the product treats such a message as outbound (a fixture error, not a product failure, not tuned to).
Three general mechanisms are to be implemented (employer-name aliasing as soft evidence, a weak employer name plus one exact specific role as a link, and an ending that confirms an earlier ending), each opt-in, each measured on the development fixtures before and after, none designed by looking at P.
**Fixture P** (8 scenarios, about 40 messages, outside the repository) was authored after the diagnosis, so it shares the REQUIREMENT categories with O (delegated mail, agencies, withdrawals, retractions, cycles, duplicates, dormancy, concurrent applications) but none of O's cases, and it is scored once with the final code. It is less independent than O was: it is a test of whether the mechanisms generalise to new cases of the same kinds, not of whether the categories were the right ones. Same thresholds as O (recall >= 90%, false opportunities <= 1, wrong merges <= 2, merged opportunities <= 1, split journeys <= 1, journeys not found 0, status >= 85%, outcome >= 75%, stage >= 75%, quiet applications stay active, unnecessary review items <= 50%). A miss is reported as a miss.

## Amendment 2 (2026-11-21), fixture R and the acceptance gate. Written BEFORE the review prioritisation, the proposed-outcome change and R's scoring
The owner's decisions after the Phase 2 report: delegated mail by evidence-grounded attribution (no alias-only merges), review prioritisation judged on independent examples, proposed and verified outcomes represented separately (a single uncorroborated reading must not silently settle an ending), and a NEW independent evaluation. O and P are development regression tests only.
**Fixture R** (outside the repository; 14 scenarios, 70+ messages, about 30 journeys) was authored from those requirements: screening vendor for two employers, agency for two employers, an ATS template for two teams, a recruiter on a webmail address, genuinely ambiguous identity (same role at two sites, one unattributable rejection), corroborated and bland endings, false closures ("unfortunately", "we regret to inform you" from a card issuer, a webinar, a trial, a job-board digest, housing), employer newsletters/events/welcome notices, requisition numbers, withdrawal then a new cycle, offers accepted and declined, a quiet application, duplicates and forwards, and a clean volume scenario. Every message carries the AUTHOR's independent judgment `ask`: would a careful assistant need to ask the student about it? Labels are written at authoring time, before any prioritisation code exists.
**Engines scored once on R:** `current` (the production pipeline), `reference` (the code at 8ee0e95, before the model-alone gate), `phase2` (final). Same model readings for all three.
**Outcome representation (design decision, owner's): a single uncorroborated reading does not settle an ending.** A verified ending (independent corroboration, or a person's confirmation) settles it. A proposed ending keeps the application visible and active with a stated proposed outcome and the evidence; it prompts for confirmation only when it materially affects a decision (the application has something live: an upcoming interview or deadline, an open offer, or conflicting later evidence). The legacy `statusAccuracy` counts a proposed ending as "not closed", so it will fall for true endings that are only proposed; it stays in the report unchanged and a regression there is reported as a regression. The new outcome metrics below are ADDED to describe the new design; none replaces an old one.
**Criteria on R (PASS or FAIL each; a miss is a miss; no re-run)**
| # | Area | Measure | Phase 2 must |
|---|---|---|---|
| 1 | Discovery | recruiting recall | >= 90% and >= current and >= reference |
| 2 | Discovery | false opportunities (non-recruiting messages in the pipeline) | <= 1 and <= current |
| 3 | Closures | true endings found as verified OR proposed | >= 90% |
| 4 | Closures | endings SETTLED (status closed) for a journey whose truth is not closed | 0 |
| 5 | Closures | non-recruiting "unfortunately / we regret" mail that closes or proposes an ending on a real application (r7) | 0 |
| 6 | Closures | settled (verified) endings that are correct | 100% |
| 7 | Identity | wrong merges (message pairs) | <= 2 and <= current |
| 8 | Identity | applications merging two journeys | <= 1 |
| 9 | Identity | journeys split across opportunities | <= 2 and <= current |
| 10 | Delegated | journeys of r1-r4 (vendor, agency, ATS, webmail) split | <= 1 |
| 11 | Delegated | links made from employer-name resemblance alone | 0 (by construction; counted from the attribution reasons) |
| 12 | Lifecycle | stage accuracy, outcome accuracy | >= 85% and >= 80%, and each >= current and >= reference |
| 13 | Review | items the system puts in the "needs you" tier | <= 3, and every `ask`-labelled message that produces an item is in that tier |
| 14 | Review | all review items including suggestions | <= 10, and <= current + 0 on the clean scenario r14 (0 items) |
| 15 | Review | precision of the "needs you" tier against the author's `ask` labels | >= 60% |
| 16 | Corrections | any change to a person's decision | 0 (property and end-to-end tests) |
**Acceptance gate for controlled promotion:** all 16 PASS on R, the best-of development gate has no regression other than the legacy status metric (explained by the owner's design decision) and review-burden metrics that are independently judged as improved, and every standard gate is green. Anything else is FAIL.
