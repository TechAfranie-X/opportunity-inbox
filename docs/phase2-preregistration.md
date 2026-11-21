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
