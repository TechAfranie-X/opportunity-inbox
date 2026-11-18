# Lifecycle integrity benchmark (Milestone 1: test-only)

Reproducible benchmark for opportunity identity, lifecycle state, deadlines, actions and review, built from the 2026-11-18 Gmail-grounded product audit. **It changes no production logic and touches no user data, evaluation label or protected dataset.** Run: `npm run bench:lifecycle` (exits 1 while the product has these defects), `npm run bench:lifecycle:check` (CI ratchet), `npm run bench:lifecycle -- --heldout` (milestone gates only).

## What is in it
| Path | Layer | Content |
|---|---|---|
| `dev/cases.ts`, `dev/lifecycle.bench.test.ts` | stored events -> grouping, state, actions, review | 20 cases (10 audit failures, 8 cases the audit found correct, 3 dormancy guards) as metadata-only event fixtures, evaluated through the product's real `buildOpportunities`, `buildActions`, `buildReviewQueue` |
| `dev/ingestion.bench.test.ts` | message text -> events | 13 synthetic messages (fictional employers) through `readMail` and `extractBodyText`: cancellation, explicit vs relative deadlines, expiry, non-recruiting assessment results, mojibake, replay |
| `heldout/` | sealed synthetic held-out | 54 scenarios from seed 20261118, truth fixed by construction (full partitions), different families from the dev cases |
| `harness.ts`, `check.ts` | | fixture builder, observation, pairwise grouping metric, facet checks |
| `known-failures.json` | ratchet | the failing tests at the recorded baseline |
| `tools/frozen-equivalence.mjs` | reference | re-runs the check that this branch's rule reader equals the frozen tag on the development mailbox |

**Privacy.** Fixtures contain no message text and no real employer: employers are pseudonyms; what is preserved is structure (types, roles, dates, thread relationships, confidences, signals, the "now"). Ingestion texts are synthetic. A private, real-structure variant can be generated locally from the person's own database and is never committed.

## How expectations are written
Expectations are what the audit's Gmail check established as TRUE (cannot-link / must-link between events, current role from the latest source, stage and active state, actions present, contradictions flagged), never what the code does. A failing test is a defect; a test is changed only if the audit evidence, not the implementation, was wrong. Cases the audit could not settle are marked `indeterminate` and assert only invariants that hold either way (e.g. one stored event per Gmail message id; the person's correction stays theirs).

## Baseline (current production logic, 2026-11-18)
Development: **60 tests, 34 pass, 23 fail, 3 pending.** Held-out (sealed, synthetic): 111 expectations, 64 pass, 47 fail; pairwise grouping precision 81.5%, recall 100% (35 wrong merges).
Categories that must never fail: `regression` (20 pass), `dormancy` exceptions (4 pass, 2 pending until the classification API exists), `idempotency` (2 pass). `--update-known` refuses to record failures in these.

## Held-out discipline
- The held-out generator and its results are not consulted while implementing; they run only at milestone gates and are never tuned against.
- BLIND labels, datasets and the evaluation store are never read by anything here (there is no import of `lib/eval-store` or `lib/recruiting/shadow`).
- A real held-out set (at least 100 opportunities from the person's own mailbox, labelled by the person with the existing label tooling) is a separate artifact kept outside the repository; this directory only defines how it is scored.

## Dormancy decision (2026-11-18)
60 days of silence is the initial dormancy threshold for **follow-up classification only**: it is not rejection or closure and never changes `status`. Exceptions that are never dormant: a known upcoming interview, an open offer or onboarding, an unexpired deadline, and any newer evidence (resets). The guards pass today; the classification contract itself is pending until the reducer exists.
