# Delivery milestone 1: a browser-verified personal MVP on real histories (2026-11-21)

Commits on `mvp`: `332e9a9` (previous MVP checkpoint) to `76a5657` (this milestone). Gmail is read-only; everything runs locally.

## What now works in the real product (account 1, browser-verified)
- **Today** shows the real interview (Harvey, today 12:00 PM, with the right interviewers) once, the real assessment, and 19 review items instead of 145.
- **Pipeline**: 33 active, 113 quiet, 4 accepted, 64 closed, 15 programs and events kept apart; a card opens the timeline (applied, assessment with its due date, invited to interview) and "Open latest email".
- **Review**: one question at a time with the real excerpt and "Open in Gmail" (opened for real: it lands on the exact message, and Gmail shows the same interview time).
- **Recruiting cycles**: Harvey's 2027 process is separate from its 2026 application (before: one 42-event group mixed both years). Any application whose messages still mention two cycles is flagged, never silent.
- **False applications and wrong outcomes**: a model-only reading cannot create an application unless the message itself states the student's own application; an offer or an ending claimed only by the model does not stand; a receipt typed as a rejection is only proposed.

## Verified independently against Gmail (read-only, message by message; nothing stored)
123 model-only "applications", 66 rule-found applications, 19 offers, 72 rejections, 61 dated interviews/assessments, 140 consequential messages through both engines (and 27 on account 2). Details in `docs/personal-mvp.md`.

## Before and after on the private real-mail corpus (895 labelled messages; labels by Claude's reading of the real messages, **owner confirmation pending**; ids and labels only, stored outside the repository)
| Measure | Before (all view-time switches off) | After (defaults) |
|---|---|---|
| Pipeline precision (judged entries) | 70.0% | 98.8% |
| False opportunities (of 216 labelled non-applications) | 216 | 6 |
| Labelled applications kept (recall) | 100% | 99.4% |
| False offers shown as offers | 4 of 4 | 0 of 4 |
| Real offers kept | 8 of 8 | 8 of 8 |
| Review "needs you" / all items | 147 / 367 | 19 / 152 |
| Active applications | 275 | 158 |
Dated interviews and assessments whose stored date occurs in the message: 61 of 61 (unchanged: nothing was fabricated).
Reproduce: `scripts/build-corpus.ts <sub>` then `scripts/corpus-metrics.ts <sub> [--details]`; the "before" row is `ENTRY_POLICY=off IDENTITY_V3=off REVIEW_PRIORITY=off`.

## High-severity defects that remain
1. **Residual false opportunities (6)**: an event waitlist (Datadog), three recruiter-contact notices (Trafigura, KPMG, TCS) and two follow-ups of a message with no employer. Rule-found, so the entry policy does not cover them.
2. **A program acceptance can still show as an offer** (Break Through Tech): it is rule-found.
3. **Harvey still has two small remnants** and a few borrowed 2026 labels inside the 2027 application (flagged as mixed cycles).
4. **Duplicated opportunities in general are reduced, not eliminated**: wrong merges fell about 50% on the development set; there is no real-mail identity labelling yet (needs the owner).
5. **Corpus labels are provisional** until the owner confirms them; the corpus is Claude's reading, not human-verified yet. The owner can edit `~/.opportunity-inbox-corpus/corpus-117880.jsonl`.
6. **Account 2** is not browser-verified (needs its owner to sign in).
7. The 15 historical corrected rows are unchanged (repair token ready, not required).

## Rollback
- Whole milestone: `git revert --no-edit 332e9a9..76a5657` (or `git checkout 332e9a9`), then restart.
- Per behaviour (set in `.env.local`, restart): `ENTRY_POLICY=off`, `IDENTITY_V3=off`, `REVIEW_PRIORITY=off`, `DECISION_ENGINE=off`.
- Stored-data stamps (one appended signal each, uncorrected rows only; backups in `~/.opportunity-inbox-sealed/`): `scripts/stamp-proposed-endings.ts <sub> --rollback <backup>` and `scripts/stamp-entry-evidence.ts <sub> --rollback <backup>`.
- Corrected rows: `scripts/integrity-check.ts compare <snapshot>` reports 139 of 139 untouched.

## Next (milestone 2)
Owner confirmation of the corpus (and labels for identity: which messages belong to which application), then improve matching against it: recruiter-contact notices and event waitlists as their own non-application kind, program acceptances, and identity merges and splits measured on real histories.
