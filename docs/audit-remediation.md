# Independent audit remediation: Evidence Integrity and Lifecycle Correctness

Date started: 2026-11-20. Branch `mvp`. Source: an independent, read-only audit of the running application and the first authorized Gmail account. The audit is treated as an
external quality report: each finding was reproduced on stored metadata first (`scripts/audit-trace.ts`, `audit-missing.ts`, `audit-coverage.ts`, `audit-review.ts`, `probe-phrases.ts`;
all read-only, none prints or stores message text), the failing STAGE was identified, and the fix is a general mechanism with positive and negative tests. No employer named by the
audit appears in any rule; the regression cases use invented employers (`lib/recruiting/audit-regressions.test.ts`, `lib/reliability/evidence.test.ts`).

## Progress record (persistent)
Continuation is NOT automatic: no scheduler is configured. Anything below marked "pending" needs a person (or a new session) to run it.

## Audit-to-fix matrix
(Filled in at the end of the milestone; see the sections below for the evolving state.)

## Data-integrity invariants (checked before and after every backfill and re-evaluation)
1. Every row carrying a person's correction or confirmation is byte-identical afterwards (hash over id, type, company, role, signals, correction).
2. No prediction is deleted: re-evaluation is a reader-version bump (`PRODUCT_READER_VERSION`), which inserts new prediction rows and leaves old ones (append-only history).
3. `saveExtractedEvents` refuses to overwrite a corrected, confirmed or ignored row (`setWhere correction is null`), and the end-to-end journey asserts it (it fails without the guard).
4. Gmail stays read-only; no message text, prompt or token is stored or committed; the model is local.
