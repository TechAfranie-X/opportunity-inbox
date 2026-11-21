# Independent audit remediation: Evidence Integrity and Lifecycle Correctness

Date started: 2026-11-20. Branch `mvp`. Source: an independent, read-only audit of the running application and the first authorized Gmail account. The audit is treated as an
external quality report: each finding was reproduced on stored metadata first (`scripts/audit-trace.ts`, `audit-missing.ts`, `audit-coverage.ts`, `audit-review.ts`, `probe-phrases.ts`;
all read-only, none prints or stores message text), the failing STAGE was identified, and the fix is a general mechanism with positive and negative tests. No employer named by the
audit appears in any rule; the regression cases use invented employers (`lib/recruiting/audit-regressions.test.ts`, `lib/reliability/evidence.test.ts`).

## Progress record (persistent)
Continuation is NOT automatic: no scheduler is configured. Anything below marked "pending" needs a person (or a new session) to run it.

## Audit-to-fix matrix (state at 2026-11-20 14:50; account 1 re-read under reader v6 complete, account 2 re-read running)
"Real" = checked on stored account-1 data after the v6 re-read (metadata only; no message text kept). Browser and Gmail click-through verification: NOT yet done for either account.

| Finding | Root cause | Code change | Tests | Real-mailbox status (account 1) | Remaining risk |
|---|---|---|---|---|---|
| Alcon June 5 rejection ignored; cycles mixed | Bland ATS subject hid terminal wording; cycle not part of identity | `closureFact`, cycle-aware identity, retraction handling | audit-regressions, evidence.test | Externship 2026 and 2027 internship are separate records (verified). The June 5 message is read as a rejection by the current rule reader (probe), BUT its stored row carries a person's "Looks right" as a status update; the guard correctly preserves it, so the lifecycle still ignores it | A person's confirmation can contradict the text. Needs a "your confirmation disagrees with the message" Review item (not built) |
| Salesforce accepted offer unresolved | A model-read promo ("You're invited") became a rejection and split the thread | Model-found rejection needs plain-text closure wording; invitation promos vetoed (c45c215) | assist.test (positive and negative) | VERIFIED: one Summer 2027 record, outcome accepted, no contradictions, promos now questions, no stale offer-decision action | Other model-created decisive events from unfamiliar promo wording |
| NSF workshop as job offer | Event words not considered | `opportunityKind` event kind | refine.test, audit-regressions | VERIFIED: kind=event (still labelled offer inside the event, excluded from job offers) | Browser not checked |
| Harvey deadlines | Competing-offer and promise dates bound to interviews | `bindDates`, cancellation fact | evidence.test | Nov 30 gone. One 2026 invite still carries Nov 25 (cannot tell from metadata whether that is a real interview date). The 2027 role is split into two records (REGRESSION) | Needs a human look in Gmail; split needs an identity fix |
| Coinbase two records, one detail | Key collisions | Exact key beats legacy key; disambiguated search | audit-regressions | Two records with distinct keys (verified). Routes/search not checked in browser | Browser |
| ZipRecruiter / Cisco confirmations absent | Out-of-window mail; platform sender vetoed as employer | none specific | - | Cisco present (verified). ZipRecruiter Sept 2026 mail is stored but vetoed as a job board, so it is not in the pipeline; Oct 2025 mail is outside the sync window | Whether the welcome mail is an application is uncertain |
| TeamWork job-alert newsletter | Alert not filtered | `marketingFact` alert | evidence.test | VERIFIED gone (only the career-fair event remains) | - |
| Review hides 49 housekeeping | Totals were not honest | Honest totals, bulk confirm | triage tests | Review now has 145 important and 219 housekeeping (367) versus the audit's 13 + 49. The fuller sweep evaluates about 2,500 more messages | BURDEN GREW. Needs a stronger prioritisation pass before student testing |
| Salesforce assessment questioned; DISC promo in Review | - | marketing/receipt rules | facts.test | Not re-checked after v6 | Check |
| Fragment roles; Today midnight rollover; pipeline buckets | - | `cleanRole`, `day-rollover`, `pipelineBuckets` | unit tests | Code only; not browser-verified | Browser |
| FALSE OPPORTUNITIES (new finding) | Model-created events from the fuller sweep | veto and corroboration (partial) | - | Pipeline grew from 201 to 352 records; 95 of 274 active records are single model-only events, many look like noise ("Unknown company", event promos, vendor mail) | REGRESSION. Needs a precision pass and a v7 re-read |

## Integrity record
- Corrected rows: 139 (85 + 54). Content and row versions were identical across the whole v6 re-read of account 1 (snapshot t3 vs t4) and across a live pass on account 2 earlier: the guard holds.
- UNRESOLVED: 15 corrected rows were rewritten between the 01:11 snapshot and later that day; their type and company match both readers, but I could not establish the cause. Not claimed as byte-identical.
- Docker Desktop shut down once during the run (clean exit); the resync is checkpointed and resumed with no loss.

## Release decision (provisional): NOT READY for unsupervised external student testing
See "Final state" at the end of this file for the current open list (this paragraph is superseded).

## Data-integrity invariants (checked before and after every backfill and re-evaluation)
1. Every row carrying a person's correction or confirmation is byte-identical afterwards (hash over id, type, company, role, signals, correction).
2. No prediction is deleted: re-evaluation is a reader-version bump (`PRODUCT_READER_VERSION`), which inserts new prediction rows and leaves old ones (append-only history).
3. `saveExtractedEvents` refuses to overwrite a corrected, confirmed or ignored row (`setWhere correction is null`), and the end-to-end journey asserts it (it fails without the guard).
4. Gmail stays read-only; no message text, prompt or token is stored or committed; the model is local.

## Fixture N pre-registration (written 2026-11-20 16:45 CST, BEFORE the first run; fixture never opened or run)
Fixture: fictional mailbox `journeys-N.json` (outside the repository), run once on commit b898056 in rules mode and in hybrid mode (local Qwen3-4B), with `--cache` so the model is called once. Baseline: commit 5230fa9, same fixture, same two modes, same single run each. After the failure list is inspected N is contaminated and is not a generalisation claim.
Thresholds (anchored on the previous fresh fixture M, hybrid: precision 97.7, recall 97.0, wrong merges 2, split 9, status 91.2, outcome 70.2, review justified 34.4):
- Recruiting precision >= 95.0 and recall >= 94.0 (hybrid)
- Wrong merges <= 3; journeys split <= 12; opportunities merging journeys <= 2
- Lifecycle status >= 85.0, outcome >= 65.0
- Source evidence 100%
- Review justified-share not below 30% and "important" count not above 1.5x the baseline
- No regression of more than 2 points against the 5230fa9 baseline on any of recruiting precision/recall, status, outcome
A miss on any threshold is reported as a miss, not re-run.

## Fixture N result (run once per mode on commit b898056 + the pre-registration commit; fixture 16 scenarios, 221 messages, 40 journeys; now CONTAMINATED once its failures are inspected, and it has not been inspected yet)
| Measure | Threshold | Rules only | Hybrid (local model) | Verdict (hybrid) |
|---|---|---|---|---|
| Recruiting precision | >= 95.0 | 100.0 | 100.0 | met |
| Recruiting recall | >= 94.0 | 59.6 (61 missed) | 84.8 (23 missed) | MISSED |
| Wrong merges | <= 3 | 21 | 25 | MISSED |
| Journeys split | <= 12 | 2 | 2 | met |
| Opportunities merging journeys | <= 2 | 4 | 6 | MISSED |
| Lifecycle status | >= 85.0 | 76.2 | 66.7 | MISSED |
| Lifecycle outcome | >= 65.0 | 61.9 | 44.4 | MISSED |
| Source evidence | 100% | 85.7 | 84.6 | MISSED |
| Review justified share | >= 30% | 34.3 | 50.0 (38 items, 8 important) | met |
Other hybrid numbers: pair precision 90.2, pair recall 95.9, stage type 94.5, next action 58.3 (as shipped) / 65.6 (evidence only), contradictions flagged 2/6, journeys not found 4. Model time 2826 s (the local 4B model).
Most thresholds were MISSED on this unfamiliar fixture. The audit-remediation work does not generalise to N as hoped; the weaknesses (false merges between employers/requisitions, lifecycle status/outcome, provenance) are not closed. The model also lowered status and outcome versus rules-only (66.7 vs 76.2, 44.4 vs 61.9), which is itself a finding.
Baseline 5230fa9, rules only, same fixture: recall 59.6, wrong merges 21, split 2, merging 4, status 71.4, outcome 57.1, stage 57.1, source evidence 80.0. So the 21 wrong merges predate this mission; rules-only status/outcome/stage/evidence improved by +4.8/+4.8/+9.6/+5.7 points. The baseline hybrid run is in progress.

### Fixture N baseline hybrid (5230fa9, run once) and the comparison: A REGRESSION IN HYBRID MODE
| Measure (hybrid) | 5230fa9 baseline | Current | Change |
|---|---|---|---|
| Recruiting recall | 93.4 (10 missed) | 84.8 (23 missed) | -8.6 |
| Recruiting precision | 100.0 | 100.0 | 0 |
| Wrong merges | 25 | 25 | 0 |
| Missed links | 15 | 10 | better |
| Journeys split | 4 | 2 | better |
| Journeys not found | 3 | 4 | -1 |
| Lifecycle status | 89.2 | 66.7 | -22.5 |
| Lifecycle outcome | 59.5 | 44.4 | -15.1 |
| Stage | 70.3 | 63.9 | -6.4 |
| Next action (as shipped / evidence only) | 70.3 / 75.8 | 58.3 / 65.6 | worse |
| Contradictions flagged | 5/6 | 2/6 | worse |
| Source evidence | 70.0 | 84.6 | better |
| Review (items, justified, important justified) | 33, 39.4, 75.0 | 38, 50.0, 62.5 | mixed |
The pre-registered rule "no regression of more than 2 points on precision/recall, status, outcome" is VIOLATED in hybrid mode (recall, status, outcome). In rules-only mode the current code is better than the baseline (status +4.8, outcome +4.8, stage +9.6, evidence +5.7).
Probable cause (NOT verified; the fixture's failures were deliberately not inspected): the model-alone-never-ends-a-candidacy change (c45c215: `closureFact` corroboration, `notAProcess` veto) removes model-found events and terminal outcomes that the baseline kept, which lowers recall and the status/outcome scores and hides contradictions. It fixed the real Salesforce case but is too blunt on unfamiliar mail. Because fixture N is sealed, any repair must be designed from the real-account and earlier-fixture evidence, validated on a NEW fixture, and needs a reader-version bump plus a full re-read of both accounts (hours).


## Final gates (2026-11-20 evening, commit 321bd17)
lint exit 0; `tsc --noEmit` exit 0; `npm test` 677 / 677 pass; `next build` exit 0; `bench:lifecycle:check` exit 0 (regression safety 20/20, dormancy 4/4); e2e journey PASSED in keyword mode and in `DISCOVERY=sweep` mode (including: a reader upgrade keeps corrections and confirmations, no message text in the database, delete-my-data). After the gates all 139 corrected rows on the two real accounts still had the same row versions (no rewrite).

## Final state and release decision: NOT READY for unsupervised external student testing
Done and verified: unit/e2e gates; account 1 and account 2 re-read under reader v6 with failed:0; corrected rows never rewritten during the v6 re-reads (row versions identical, 139 rows); Salesforce, NSF, Cisco, Coinbase (two keys), TeamWork on account 1; account 2 is clean (40 Review items, 4 model-only single active records).
Not done / open, in priority order:
1. HYBRID REGRESSION on the sealed fixture (above): recall 93.4 -> 84.8, status 89.2 -> 66.7, outcome 59.5 -> 44.4, contradictions 5/6 -> 2/6. Probable cause is the c45c215 model-event veto (unverified). Fixing it needs a design from non-sealed evidence, a NEW fixture, a version bump and a re-read of both accounts.
2. Account 1 false opportunities and Review burden (352 records, 95 single model-only active, Review 367 vs the audit's 13 + 49).
3. Most pre-registered fixture N thresholds missed (recall, wrong merges, merging, status, outcome, evidence). The 21 rules-only wrong merges predate this work.
4. Harvey 2027 role split into two records; one 2026 invite with a possibly wrong Nov 25 date.
5. Alcon June 5 rejection: a person's confirmation overrides the message text and no "your confirmation disagrees" Review item exists.
6. ZipRecruiter welcome mail (vetoed as a job board) and the Oct 2025 mail outside the sync window: uncertain.
7. No real-browser verification of either account (Today rollover, Pipeline buckets, Coinbase routes/search, Gmail click-through) and no Gmail click-through of any finding; account 2 needs its owner.
8. Unexplained: 15 corrected rows were rewritten between the 01:11 snapshot and later on 2026-11-20 (before the v6 work). Not claimed byte-identical.
Nothing here continues automatically; no scheduler remains configured after this session.


## Update after Phase 1 (2026-11-20, see docs/phase1-foundation.md)
- Direction set by the owner: evidence ledger, unified decision engine, existing reducer and correction protections retained. Built in shadow mode only; no production decision changed. The model-alone-never-ends-a-candidacy gate (c45c215) is still in the production pipeline and its regression is still live; the shadow engine restores the pre-regression numbers offline.
- Integrity record, new facts: 124 of 139 corrected rows carry the restore-transaction versions; the 15 others each carry their own later version; none of the 139 changed since 06:41 or during Phase 1 (`scripts/integrity-check.ts` compare: OK). The cause of the 15 earlier rewrites is still UNRESOLVED (a pre-guard worker or per-row UI actions both fit; the data cannot separate them).
- Fixture N and J to M are contaminated development fixtures now; the fresh independent evaluation (fixture O) is reserved for release validation.
