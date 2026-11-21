# Phase 2 completion report

Date: 2026-11-21. Status: **shadow engine only; not promoted; no Gmail re-read; Phase 3 not started.** Every standard gate is green on the final code (lint, typecheck, 716 of 716 tests, lifecycle benchmark, build, end-to-end in keyword and sweep modes, production eval gate, real-account integrity check: 139 corrected rows untouched).

## 1. Acceptance against the pre-registered criteria
Fixture R (the first independent evaluation) was scored once on the code at 42ceb10: **10 of 16 criteria PASS, FAIL.** Its failures were inspected afterwards, so R, O and P are development fixtures. Two general gaps were fixed (one receipt per application for specific roles too; requisition numbers as identity inside an employer's applications) and measured on the development set. Fixture S, written after that diagnosis and pre-registered before scoring (docs/phase2-preregistration.md, Amendment 3), was scored once on the final code:

    PASS  #1  recall >= 90 and >= current and >= reference
    PASS  #2  false opportunities <= 1 and <= current
    PASS  #3  true endings found as verified or proposed >= 90%
    PASS  #4  endings settled for a journey that did not end = 0
    PASS  #5  non-recruiting 'unfortunately' mail closes or proposes an ending on a real application = 0
    PASS  #6  settled (verified) endings correct = 100%
    PASS  #7  wrong merges <= 2 and <= current
    PASS  #8  applications merging two journeys <= 1
    PASS  #9  journeys split <= 2 and <= current
    PASS  #10 delegated journeys (r1-r4) split <= 1
    PASS  #11 links from employer-name resemblance alone = 0
    PASS  #12 stage >= 85 and outcome >= 80, each >= current and >= reference
    PASS  #13 'needs you' items <= 3 and every ask-labelled message that produces an item is in that tier
    PASS  #14 all review items <= 10 and 0 on the clean scenario r14
    PASS  #15 precision of the needs-you tier against the author's ask labels >= 60%
    PASS  #16 any change to a person's decision = 0

**Verdict: PASS on S (16 of 16); FAIL on R (10 of 16); therefore the acceptance gate is PASSED ONLY ON THE LAST FIXTURE AFTER A FAILURE AND A FIX, which is weaker evidence than a first-time pass.** Honest limits: S has 36 messages and 17 journeys (one journey is about 6 points); it has two ask labels; it was written by the engine's author after seeing why R failed, so it tests whether the fixes generalise to new cases of the same kinds, not whether the categories were right; the scoring script's #10 and #14 look up R's scenario names, so I checked them by hand against S (the delegated scenario s1 has no identity failures; the clean scenario s7 raises 0 items) and both hold. S is now contaminated.

## 2. What S still shows (remaining failures, by journey key)
- A bank's "we regret to inform you" message still becomes a visible false opportunity typed as a rejection (1 false opportunity, equal to current); it attaches to no application and is a low-priority doubt, never an ending.
- A bland "gone in a different direction" ending on an application with a scheduled interview is PROPOSED (not settled), the application stays active, and it is asked about (as it should be). The scenario's truth is "still active", so the metric counts it as a wrong proposal.
- The unattributable invitation is kept as its own record and asked about: the intended behaviour, counted as one split journey.
- A welcome/onboarding message after an accepted offer is missed (a veto on welcome notices).

## 3. Development set (six fixtures, frozen readings): accuracy, merges, splits, lifecycle, review burden
| metric | reference 8ee0e95 | current (frozen baseline) | Phase 2 | vs best of both |
|---|---|---|---|---|
| recruitingRecall | 95.3 | 90.7 | 95.3 | equal (0) |
| recruitingPrecision | 98 | 98.1 | 98.3 | better (+0.2) |
| falseOpportunities | 13 | 12 | 11 | better (-1) |
| wrongMerges | 71 | 64 | 20 | better (-44) |
| missedLinks | 148 | 133 | 136 | WORSE (+3) |
| journeysSplit | 33 | 28 | 34 | WORSE (+6) |
| opportunitiesMergingJourneys | 20 | 20 | 8 | better (-12) |
| statusAccuracy | 89.1 | 74.9 | 73.6 | WORSE (-15.5) |
| outcomeAccuracy | 68.9 | 58.6 | 56.5 | WORSE (-12.4) |
| stageAccuracy | 75.5 | 66.3 | 67.7 | WORSE (-7.8) |
| sourceEvidence | 95.6 | 94.1 | 97.7 | better (+2.1) |
| reviewItems | 144 | 157 | 108 | better (-36) |
| importantItems | 79 | 68 | 51 | better (-17) |
| reviewJustifiedShare | 48.6 | 56.1 | 51.9 | WORSE (-4.2) |
| importantJustifiedShare | 67.1 | 58.8 | 74.5 | better (+7.4) |
Reading it: identity is far better than either baseline (wrong merges 20 against 64 and 71; merged applications 8 against 20); discovery recall is back to the pre-regression level and every false-opportunity and review-quality number is at least as good as the better baseline except three. **Legacy status, outcome and stage accuracy are WORSE than the best of both baselines** (status 73.6 against 89.1, outcome 56.5 against 68.9, stage 67.7 against 75.5). That is the direct, expected cost of your rule that a single uncorroborated reading must not settle an ending: 30 of 74 true endings on the development set are now "proposed" (active, visible, evidence kept) and the legacy metric counts a proposed ending as not closed. The new outcome metrics describe the new design: of 74 true endings, 29 are verified, 30 proposed, 15 missed; 1 ending wrongly settled and 4 wrongly proposed. "Contradictions flagged" fell from 63 to 50 only because 4 journeys had been flagged by unrelated doubts that no longer ask; the explicit contradiction detector is unchanged (14 of 30).

## 4. Review burden
Items that need the student ("needs you") on the development set fell from 74 to 51 (79 for the pre-regression reference) and their justification rose from 54% to 74%. By kind: contradiction questions 90% justified; proposed endings that survive (only when something is pending) 9 of 9; consequential unattributable messages 57%; a doubt on a routine message is now a collapsed suggestion. 35 optional suggestions are shown collapsed and uncounted. Judging used the fixture ground truth (not my tier logic) and, on R and S, the author's separate "would a careful assistant ask?" labels. The label set is thin (1 label on R, 2 on S), so precision on it is a weak measurement.

## 5. Ablations (controlled, cached replay; each against the same readings)
| change | effect |
|---|---|
| verified represented employer for delegated mail | wrong merges 57 to 32, merged applications 15 to 10, review items 148 to 126; cost: about 12 more missed links |
| evidence-scored attribution | small gain, no wrong merges added |
| one receipt per application for specific roles, requisition identity | wrong merges 32 to 20, merged applications 10 to 8 |
| tiering with "pending" liveness | needs-you items 74 to 52, justification 54% to 73% |
| settle a single-reading ending when it shares the application's thread and sender (REJECTED) | verified endings 29 to 51 and legacy status back to 84.5, but wrongly settled endings 1 to 5: it corroborates which application a message belongs to, not that it is an ending |
| automatic alias merge, weak-employer role link (REMOVED in earlier rounds) | about 12 wrong merges for 2 recovered links |

## 6. Corrected-record repair: awaiting your approval (nothing changed)
Read-only plan: **15 rows** (identifiers in the plan file outside the repository, hashed account ids on screen), columns `role` (to empty), `field_confidence.role` (to 0), `signals` (remove one `role-inherited`); previous values are kept in the plan and in a backup table created inside the same transaction; apply is one transaction that locks each row, aborts everything on any mismatch, and verifies the person's correction is byte-identical; rollback restores exactly (tested in the scratch database: refuses without the token, all-or-nothing, exact rollback). Plan fingerprint (the approval token): **e345cacd8b99**. 7 further corrected rows carry the same marker from before the audit window; they are excluded and need your decision. Apply needs both the token and `--real`. I have not run any of it on the real database.

## 7. Recommendation
The architecture is sound and the evidence-grounded design does what it was meant to: identity errors fall sharply, endings are never silently settled by one reading, delegated mail is attributed by corroborated evidence, and the review queue shows far fewer, better questions. It is **not ready for production promotion**. It is ready for a **controlled, reversible canary that changes no decision**: turn on the shadow ledger for newly read mail, compare its verdicts with production's on live mail, and have you label a sample. Reasons to wait: the gate passed only on the second independent fixture and only after a failure; the fixtures are small and share one author; two ending misses are model-reading misses; the legacy lifecycle numbers are worse by design and you must accept that trade explicitly; the 15 repaired rows are still unrepaired. Phase 3 should not start until you decide on the repair, accept or reject the legacy-metric trade, and approve (or not) the shadow canary.
