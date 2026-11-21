# M30 engineering cycle: handoff and state (2026-11-22)

Starting point: the independent audit of commit `acb5bdf` (432 Review rows built for 133 shown, explicit rejections left open, withdrawn application shown as accepted, event/admin/marketing mail advancing job stages, fragmented journeys). North Star: reconstruct each recruiting journey from evidence with almost no user intervention.

## Process and data state (verified after the laptop slept)
- The long full-mailbox stamp **crashed** (not still running): the Gmail access token expired mid-run (`GmailAccessError: reconnect_required`, a 401 after the sleep stretched the run past one token lifetime). The script writes to the database only after every message is fetched, so **nothing was written by the crashed run** (checked: no `class:marketing` rows, newest backup is from the last good targeted run). Gmail itself works (read-only fetch tested).
- Fix: `scripts/stamp-message-evidence.ts` now refreshes the access token every 100 messages and prints progress. Two targeted modes replace full restamps: `--refresh` (re-derive ending/withdrawal/receipt facts for rows that carry them, rejection rows and listed id prefixes, and REMOVE stale ones) and `--modeled-unclassed` (only model-found/near-miss rows with no message class). Both are dry-run unless `--apply`.
- Stamps applied this cycle (all uncorrected rows only; backups in `~/.opportunity-inbox-sealed/`, rollback with `--rollback <file>`, removals saved beside as `<file>.removed.json`): `…1795249447034` (full pass: endings, withdrawals, admin/logistics/event classes, requisition), `…1795249571529`, `…1795249632232`, `…1795249680093`, `…1795282436026` (marketing, 2 rows), `…1795282490873`, `…1795282610901` (refreshes).
- No dev server restart needed; `next dev` is up on :3000. Gmail stays read-only.
- NVIDIA correction from the previous cycle (owner-approved) is the only changed corrected row: integrity compare shows 138 of 139 identical.

## What changed (generalizable mechanisms)
1. **Terminal-state evidence** (`lib/reliability/evidence.ts`, `evidence-signals.ts`, `lib/recruiting/entry-policy.ts`): `endingSentence`/`ownEnding` (employer-voice ending about the reader's own application, not conditional, not first-person, not quoted, soft-wrapped lines joined), `withdrawalAcknowledged`, `own:receipt`. View layer: a plain own ending settles (typed rejection, credible), an acknowledged withdrawal closes as withdrawn, a decisive near miss of a known employer enters the pipeline, a receipt typed rejection becomes applied. Quote headers with `Date:` and forwarded markers are cut.
2. **Message classes** (`lib/reliability/message-class.ts`): event, survey, notice, community, admin (codes/preferences), logistics (travel/background check/reimbursement/immigration), marketing, program-acceptance. They never advance a stage and Review no longer asks about mail a class already explains.
3. **Review** (`lib/recruiting/review.ts`, `app/components/triage.tsx`): one card per Gmail message (all reasons folded), no bulk "Looks right", honest totals line.
4. **Identity** (`lib/lifecycle/identity.ts`, `represented-employer.ts`): parenthesised posting number is a requisition, same-requisition/half-day repeat receipts, subject/role programme type (externship vs internship) conflicts and attribution, class isolation, alias/timing/thread tolerance, ended-cycle rule.
5. `scripts/autonomy-scorecard.ts <sub> [--details] [--json out]`: audit metrics on the live workspace (no labels).

## Numbers (live workspace, account 1)
| Measure | Audited `acb5bdf` | Now |
|---|---|---|
| Review rows built | 432 | 297 |
| Duplicate rows (same Gmail message) | 12 visible (63 repeats in the hidden list) | 0 |
| Needs-you / housekeeping / weak (counted openly) | 17 / 116 / 299 (nav showed 133) | 10 / 98 / 189 |
| Items resolved by class and not asked | 0 | 121 |
| Explicit ending text but application open | 3 audited + Harvey 2026 + SLAC | 0 |
| Class/event/admin mail advancing a job stage | many | 0 |
| Accepted AND withdrawn | 1 (SLAC) | 0 |
| Pipeline | 27 active · 95 quiet · 3 accepted · 62 closed · 19 programs | 24 · 90 · 2 · 75 · 18 |
| Frozen validation set (dev data): recall / false opportunities | 72/72 / 0/14 | 72/72 / 0/14 |
| Corpus false opportunities / precision | 3/216 / 99.4% | 3/216 / 99.4% |

Browser-verified: Review shows 10 needs-you matching the badge; Pipeline totals above; Harvey 2026 "Closed after a rejection" and Harvey 2027 active interview; PayPal, Uber Career Prep, Volvo, AMD closed as rejected; SLAC closed as withdrawn; Alcon externship consolidated into one application.

## Known defects left (for the next cycle and the fresh holdout)
1. Tiffany: a rejection that names its role only in the sentence ("…for the Internship - Digital, North America position") still asks which of two requisition applications it belongs to (stored role is generic). Fix: derive the role named in the ending sentence as identity evidence.
2. Stanford's two February receipts remain a separate small application from SLAC (different employer names, no shared thread); the frozen set labels SLAC "active/offer" but the audit and the evidence say withdrawn, so that label is outdated.
3. Alcon: one role-less orphan (headshot/LinkedIn mail); Salesforce accelerator/Insiders/BAL are not modelled as linked program/vendor entities; Project Destined still has several partner-program groups with weak evidence. The evidence-graph relations (`vendor_for`, `hosted_by`, `program_of`) were not built.
4. CodePath keeps one unrelated proposed rejection from a marketing mail whose wording the cue list reads as an ending (shown, not closing).
5. Current-message extraction is applied to the deterministic facts and quote cutting, not to the local model's input (that would invalidate cached model readings; do it with a targeted re-read if wanted).
6. The mixed/"Housekeeping" tier labels in the Review card chip can show "Housekeeping" on an important card.
7. Validation is still not independent: draw a fresh holdout per `docs/validation-workflow.md` before any accuracy claim. Scorecard invariants are necessary, not sufficient.

## Commands
- Gates: `npx tsc --noEmit && npm run lint && npm test && npm run bench:lifecycle:check && npm run build && DB_CONTAINER=opportunity-inbox-mvp-db-1 npm run e2e:sample` (also `DISCOVERY=sweep`).
- Integrity: `node --env-file=.env.local --no-warnings --import ./scripts/loader/register.mjs scripts/integrity-check.ts compare <snapshot>` (snapshot lives in the session scratchpad; take a new one with `snapshot <file>`).
- Scorecard / metrics: `scripts/autonomy-scorecard.ts`, `scripts/validation-metrics.ts`, `scripts/corpus-metrics.ts` (each takes the account sub).
- Rollback of this cycle: `git revert` the commits after `acb5bdf`; stamps via `--rollback` files above; switches `ENTRY_POLICY=off IDENTITY_V3=off REVIEW_PRIORITY=off DECISION_ENGINE=off`.

## Checkpoint 2 (after f9992cc): named-role evidence and employer-named-in-subject
Interrupted by a sleep; nothing was running afterwards (checked processes, git status, newest stamp backup). State at this checkpoint is clean and committed.

- **Named-role evidence** (`namedRole` in `lib/reliability/evidence.ts`, signal `role:named:<position>` from `evidence-signals.ts`): the position a message names in its own current text ("…selected to move forward for the Internship - Digital, North America position", "your application for Software Engineer Intern (Summer 2027)"). Identity (`groupEventsV2`) uses it as the role only when the stored role is not specific and the event is not corrected/confirmed, so it can add a join but never override a specific role, a requisition, a cycle or a programme conflict. Sentence-like captures, generic phrases and over-long strings are rejected.
- **Employer named in the subject** (`subjectNamesEmployer` in `lib/lifecycle/identity.ts`): an employer whose name appears in the message subject is no longer "weak" (not sender-only), which removed 26 cross-employer identity suggestions (a Pinterest rejection "belonging" to Figma, etc.), not by hiding them but because the evidence refutes them.
- **Stamp modes** (`scripts/stamp-message-evidence.ts`): `--role-less` (events with an empty or bare stored role; fetched 473, 55 got a signal) and `--refresh` now also removes stale `role:named:*`. Backups: `…1795283535183`, `…1795283643507` (+ `.removed.json`) in `~/.opportunity-inbox-sealed/`. Rollback with `--rollback <file>`.
- `scripts/review-snapshot.ts <sub> [--tier important|routine|weak]` lists the Review queue (ids, kinds, reasons; no text).

Verified: Tiffany is two requisition-backed applications (UX Design and Digital, North America), each with its confirmations and its own rejection, both Closed (before: four records, two rejections asking which application). Every one of the 24 pipeline events carrying a named role sits in a group whose role agrees with it (no cross-role merge). Gates: types, lint, 766 tests, eval gate, lifecycle benchmark pass; frozen validation set unchanged (recall 72/72, false opportunities 0/14); corpus false opportunities 3/216; integrity 138/139 identical (the one change is the owner-approved NVIDIA correction).

Review now: needs-you 4 (was 10, audit 17), housekeeping 85, weak 187, duplicate rows 0, 123 resolved by class. Remaining important items: an Adobe rejection a second reader flagged as unrecognised hiring mail, a Patreon rejection suggested to another application, an Electronic Arts Forage simulation, and one more. Next best steps (not started): settle a single-event rejection whose employer is named in its own text without asking; investigator cache table for structured decisions; vendor/host/programme relations (BAL/Salesforce, Project Destined); give the local model current text + quoted history separately for NEW mail only (flag-guarded so cached replays still hit).
