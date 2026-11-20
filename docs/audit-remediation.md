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
Open: false-opportunity and Review-burden regression, the person-confirmation conflict, the Harvey split, no browser verification, account 2 not re-read, fixture N not run, final gates not re-run.

## Data-integrity invariants (checked before and after every backfill and re-evaluation)
1. Every row carrying a person's correction or confirmation is byte-identical afterwards (hash over id, type, company, role, signals, correction).
2. No prediction is deleted: re-evaluation is a reader-version bump (`PRODUCT_READER_VERSION`), which inserts new prediction rows and leaves old ones (append-only history).
3. `saveExtractedEvents` refuses to overwrite a corrected, confirmed or ignored row (`setWhere correction is null`), and the end-to-end journey asserts it (it fails without the guard).
4. Gmail stays read-only; no message text, prompt or token is stored or committed; the model is local.
