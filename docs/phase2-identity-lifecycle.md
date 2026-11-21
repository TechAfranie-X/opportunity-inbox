# Phase 2: application identity and lifecycle reasoning

Status: built in shadow mode and measured. **Not promoted, and it does not meet the release gate.** Nothing in this phase changes what the real accounts see: every identity option is opt-in through an optional context that only the evaluation harness passes, the ledger recording stays off, and the confirmation-conflict item is behind a default-off flag.

## 1. The corrected-row rewrites: root cause found, fixed, tested
**Finding.** The 15 corrected rows that changed after the 01:11 snapshot were rewritten by `inheritStoredRoles` (lib/recruiting/store.ts). After every sync chunk it loaded every row of the account, including rows a person had corrected or confirmed, filled an empty role from the thread, and updated the row one statement at a time, appending a `role-inherited` signal. The upsert guard (`setWhere correction is null`) never applied because this was a separate UPDATE.
**Evidence (read-only, on the real database):** all 15 rows with distinct later row versions carry the `role-inherited` marker (15 of 15); none of their corrections names a role; each was written by its own statement; their prediction history shows re-reads at 01:23 to 01:47 (reader v3) and 02:22 to 02:39 (v5), after the guard was committed, so a stale pre-guard worker is excluded; of the 124 restored rows only 7 carry the marker (inherited before the restore).
**Fix.** The update skips every row that carries a correction, confirmation or ignore (corrected rows still serve as sources of a role), and the SQL itself carries `correction IS NULL`. **Tests:** a failing-first end-to-end check (a confirmed, role-less row in a thread that has a role must be byte-identical afterwards; it failed before the fix and passes in keyword and sweep modes); `lib/recruiting/writers.test.ts` lists every write path to `recruiting_events` with its justification and fails when a new one appears or the guard is removed.
**Audit of all other writers:** the upsert and the prune are guarded; the edit, confirm, ignore and reset actions are the person's own; "delete my data" is deliberate. No other unguarded path exists.
**Instrumentation (development only).** `scripts/dev/corrected-row-audit.sql` is a trigger that records the column names, transaction and connection of any change to a corrected row. It is installed only in the scratch end-to-end database, where it shows no automated write during the whole journey and records a deliberate one. It is NOT installed in any real database and is not a migration; installing it anywhere real needs your approval.
**What is still wrong in the real data.** The 15 rows still carry the inherited role and signal; the fix prevents recurrence but does not repair them, and I have changed no production row. A repair would set the role back to empty and remove the signal for exactly those 15 (inherit only ever fills an empty role, and their corrections do not name one). That is a data change to rows a person vouched for, so it needs your explicit approval.

## 2. What was built (all opt-in, all behind the existing gates)
| Area | Mechanism | Evidence it is general | Effect on the development set |
|---|---|---|---|
| Identity | **Role equivalence** (lib/identity/role-equivalence.ts): does "Mobile SWE Intern" name the same job as "Software Engineering Intern (Mobile)"? A tiny cached model judgment on role NAMES only; "different" may always separate, "same" joins only with the Gmail thread behind it; a cycle or programme conflict is never overruled | the oracle is 84% accurate (36 of 43 pairs) against ground truth; asymmetric on purpose (a wrong merge hides an application) | recovers missed links, adds no wrong merges |
| Identity | **Weak employer names**: a name that only names the sender does not stop a reply in the same thread joining its application | a sender-only name is not evidence of another employer | fewer missed links and splits |
| Identity | **Distinct-thread receipts**: a role-less receipt in a different Gmail thread is another application (a repeat delivery shares its thread) | one receipt per application | wrong merges 68 to 57, merged opportunities 19 to 15 |
| Identity | **Ending confirmation** (specific-role match only): the employer confirming an ending that is already recorded joins that application | an ending can follow an ending | small gain, zero added merges |
| Identity | **Possible link**: a message whose employer has no application but whose one specific role matches exactly one recent application under an alias or agency name becomes a Review QUESTION, never a link | names alone cannot tell "Corvid" / "Corvid Systems" (one employer) from "Marambaia" / "Marambaia Seguros" (two divisions) | 7 of 9 suggestions across all fixtures named the right application |
| Lifecycle | **Proposed endings**: an ending resting on one uncorroborated reading closes the application and is flagged `closureProposed` | endings are 79% precise when proposed, 100% when verified (Phase 1) | none until the engine is promoted |
| Lifecycle | **Confirmation conflict** (flag `CONFIRMATION_CONFLICTS=on`, default off): a plain "Looks right" that a later reading of the same message disagrees with becomes a Review question; the confirmation stays authoritative and nothing is rewritten | the Alcon pattern; an explicit edit is a decision and is never asked about | n/a (needs stored readings) |
| Lifecycle | **Dormancy**: tested as an invariant: silence never closes, rejects or changes an application; it is only a low-priority suggestion between 60 and 180 quiet days and nothing after | existing behaviour, now enforced by a test | none |
| Correction safety | property tests: 300 random event sets in the current and the Phase 2 identity: a person's type, company, role, "belongs with" and "keep separate" decisions hold; regrouping is order-independent; both guarantees mutation-checked | | |

**Tried, measured and REMOVED.** Automatic employer aliasing and weak-employer role links each cost about 12 wrong merges for 2 recovered links on the development set, even as a strict fallback, so they were removed and replaced by the question above. The permissive variant of ending confirmation (any relation, same thread) recovered 26 missed links but added 11 wrong merges; it is not used. This is the recovery versus false-merge trade-off, measured: here, recovery by automatic linking was bought with merges that hide applications, so the system asks instead.

## 3. Evaluation, by area (pooled over the six development fixtures; frozen readings; identical model output for every column)

**Discovery**

| metric | reference (8ee0e95) | baseline (current) | Phase 2 | vs best-of |
|---|---|---|---|---|
| recruitingPrecision | 98 | 98.1 | 98.3 | better (+0.2) |
| recruitingRecall | 95.3 | 90.7 | 95.3 | equal (0) |
| falseOpportunities | 13 | 12 | 11 | better (-1) |
| missedApplications | 32 | 63 | 32 | equal (0) |
| typeAccuracy | 87.5 | 87.7 | 86.9 | worse (-0.8) |

**Identity and grouping**

| metric | reference (8ee0e95) | baseline (current) | Phase 2 | vs best-of |
|---|---|---|---|---|
| pairPrecision | 92.9 | 93.2 | 94.4 | better (+1.2) |
| pairRecall | 86.3 | 86.8 | 88.8 | better (+2) |
| wrongMerges | 71 | 64 | 57 | better (-7) |
| missedLinks | 148 | 133 | 121 | better (-12) |
| journeysSplit | 33 | 28 | 30 | worse (+2) |
| opportunitiesMergingJourneys | 20 | 20 | 15 | better (-5) |
| journeysNotFound | 6 | 8 | 6 | equal (0) |

**Lifecycle**

| metric | reference (8ee0e95) | baseline (current) | Phase 2 | vs best-of |
|---|---|---|---|---|
| statusAccuracy | 89.1 | 74.9 | 89.6 | better (+0.5) |
| outcomeAccuracy | 68.9 | 58.6 | 69.9 | better (+1) |
| stageAccuracy | 75.5 | 66.3 | 76 | better (+0.5) |
| nextActionAccuracy | 59.6 | 50.3 | 59.6 | equal (0) |
| nextActionEvidenceOnly | 77.3 | 66.4 | 79.2 | better (+1.9) |
| contradictionsFlagged | 63.3 | 46.7 | 66.7 | better (+3.4) |
| sourceEvidence | 95.6 | 94.1 | 95.6 | equal (0) |

**Review burden**

| metric | reference (8ee0e95) | baseline (current) | Phase 2 | vs best-of |
|---|---|---|---|---|
| reviewItems | 144 | 157 | 150 | worse (+6) |
| importantItems | 79 | 68 | 82 | worse (+14) |
| reviewJustifiedShare | 48.6 | 56.1 | 50.7 | worse (-5.4) |
| importantJustifiedShare | 67.1 | 58.8 | 65.9 | worse (-1.2) |

## 4. Independent, unseen evaluation
Fixtures O and P live outside the repository, were written before the mechanisms they test, and were each scored once per engine on the frozen code. After scoring, their failure lines were inspected (journey keys only), so **both are now contaminated and may not be used again as unseen evidence.** O was authored before any Phase 2 identity code existed; P after the O diagnosis (it shares O's requirement categories, not its cases). A fixture authoring error is reported in section 6.

| Fixture O (55 messages, 15 journeys) | Threshold | current | Phase 2 (frozen run) | Verdict |
|---|---|---|---|---|
| recruiting recall | >= 90% | 100% | 100% | met |
| false opportunities | <= 1 | 1 | 1 | met (the one is the fixture's own error, section 6) |
| wrong merges | <= 2 | 0 | 0 | met |
| opportunities merging two journeys | <= 1 | 0 | 0 | met |
| journeys split | <= 1 | 4 | 4 | **MISSED** |
| journeys not found | 0 | 0 | 0 | met |
| status / outcome / stage | >= 85 / 75 / 75 | 100 / 100 / 100 | 100 / 100 / 100 | met |
| quiet application stays active | 100% | yes | yes | met |
| unnecessary review items | <= 50% | 50% | 50% | met (exactly at the limit) |
| correction preservation | 0 changes | | | met (property and end-to-end tests) |

| Fixture P (35 messages, 14 journeys) | Threshold | current | Phase 2 (frozen run) | Verdict |
|---|---|---|---|---|
| recruiting recall / false opportunities | >= 90% / <= 1 | 100% / 0 | 100% / 0 | met |
| wrong merges / merged opportunities | <= 2 / <= 1 | 0 / 0 | 0 / 0 | met |
| journeys split | <= 1 | 4 | 3 | **MISSED** (better than current) |
| status / outcome / stage | >= 85 / 75 / 75 | 92.9 / 92.9 / 78.6 | 100 / 100 / 85.7 | met |
| quiet applications stay active | 100% | yes | yes | met |
| unnecessary review items | <= 50% | 0% | 0% | met |

Reading these honestly:
- On both fixtures Phase 2 is equal to or better than the current pipeline on every lifecycle number, and neither engine makes a wrong merge. Neither separates the engines much: the fixtures turned out easier than the development set, so they give weak evidence about the regression Phase 1 repaired, and strong evidence about what Phase 2 still does not do.
- **The one repeated miss is the same on both: applications are split when someone writes on an employer's behalf.** On P the splits are two screening-vendor journeys and one agency journey; on O they were the vendor, the agency and the withdrawal confirmation. Phase 2 fixes the withdrawal confirmation and paraphrased roles, but it does NOT automatically join vendor or agency mail to the employer's application. It now asks (possible link), which converts silent splits into questions.
- The questions cost review burden. With them (final code, rerun for transparency on the now-contaminated fixtures): O review items 2 to 6 (4 unnecessary of 6, 67%, over the 50% threshold), P 1 to 4 (3 of 4). The harness counts an identity question about a correctly typed event as unnecessary; I did not change that definition to improve the number. Whether a possible-link question is worth asking is a product decision (section 8).

## 5. The release gate (not weakened, not rewritten)
The existing baseline gate passes for the production pipeline (it is unchanged). The new best-of release gate compares the Phase 2 engine with the element-wise best of the frozen baseline and the pre-regression reference. **Phase 2 fails it on three review-burden metrics** (justified share of review items, justified share of important items, and the number of important items, 68 to 82); every other metric is within the gate's tolerance of the best of both and most are better, but three are slightly WORSE than the best of both (type accuracy -0.8, journeys split +2, review items +6, all inside tolerance), so this is not a clean sweep. The release gate is therefore **NOT met**.
The cause is the trade-off, not a bug: recovering the 31 applications the current pipeline loses (recall 90.7 to 95.3) brings back their questions, and the possible-link questions add more. Removing them would hide real ambiguity; keeping them fails the gate. I have not changed the gate.

## 6. Fixture errors and limits
- O's message o4c (a forward the student sent to themselves) was authored as inbound. The product treats a message the person sends as outbound, so the "false opportunity" it produced is a fixture error, not a product failure, and no mechanism was tuned to it. P authors such copies as outbound.
- Both fixtures are small (15 and 14 journeys); one journey is 7 to 8 percentage points. Counts are given beside percentages for that reason.
- Fixtures share one author with the code; real labelled mail does not exist yet.
- Role judgments come from a 4B local model (84% on 43 pairs).

## 7. Deployment boundaries kept
EVIDENCE_LEDGER stays off for real accounts (0 ledger rows). CONFIRMATION_CONFLICTS is off. The Phase 2 identity options are passed only by the harness; `groupEventsV2` called without them is byte-for-byte the previous behaviour (the production gate passes). No destructive migration, no real-database trigger, no hosted transmission, no model training. Gmail stays read-only. The real database was only read in this phase (counts and the integrity compare), apart from the additive table applied in Phase 1.

## 8. Remaining regressions and decisions
1. Release gate not met (review burden).
2. Vendor and agency mail is split (now a question). Needs either the model to name the employer on delegated mail (an extraction change and a new reading run) or your decision to accept the question.
3. Nothing is promoted: the decision engine, the identity options and the proposed-ending flag are still shadow code.
4. The 15 affected corrected rows need an approved repair.
5. The pre-regression number the current production pipeline lost (recall 95.3 to 90.7, status 89.1 to 74.9) is still live in production until the decision engine is promoted.
