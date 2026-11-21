# Milestone 2: identity and decision accuracy on real Gmail histories (2026-11-21)

Verdict: **PASS for the stated Milestone 2 work, with the honest limits below. FAIL for any claim of validated production accuracy**: the frozen validation set is development data now (its failures were inspected while fixing), no independent evaluator has labelled anything yet, and the broader corpus labels are still Claude's own reading. The final commit on `mvp` for this milestone is the snapshot for the independent audit.

Gmail stayed read-only. Local model only. No paid services. No production database trigger. The 15 historical corrected rows were not repaired.

## What changed (generalizable mechanisms, no employer-specific rules)
- **Message classes** (`lib/reliability/message-class.ts`): event/RSVP/waitlist/webinar, survey, platform "a contact reached out" notice, community/visit registration, and *program acceptance* are recognised from wording. They never create or advance an application, they cluster apart from an application's own mail unless the same Gmail thread ties them in, and an acceptance into a programme (no employment wording, no explicit offer) is a programme, not a job offer. An employer's own interview invitation or assessment request is never classed away.
- **Missed rejections become proposed endings**: an update whose sentence ends the application shows as a proposed rejection, only when a real application at the same employer exists; a student's own first-person narration is excluded. Nothing is settled on it.
- **Identity**: receipt-likeness (a portal code, availability confirmation, welcome or preferences email is not another application); the same requisition (also read from the stored subject) or the same specific role within half a day is one application's repeat confirmations; employer aliases linked by a message naming the longer form, by timing, and for sender-only names; one Gmail thread or a reply keeps an application together although the employer is named differently; a role-matched message with no cycle long after a season ended starts a new cycle; a hackathon application is not the employer's job application; model-only "applied" messages that are not receipts wait as possible items; interview-typed invitations from online-assessment platforms are assessments.
- **Review**: a role naming a year range ("2026-2027 AI Program") is one programme year, not "mixed cycles"; a programme acceptance reads "accepted into this program", not "offer".
- Stored-data stamps (`scripts/stamp-message-evidence.ts`): appended signals on **uncorrected** rows only, dry-run default, backups in `~/.opportunity-inbox-sealed/`, `--rollback`. Final stamp backup: `stamp-evidence-117880-1795245222553.json`.

## Before and after
Frozen validation set (91 real messages, 28 journeys; labels by Claude, hash in `docs/validation-set.sha256`; 2 disputed items excluded):

| Measure | Baseline (commit 2b64dd9) | Final |
|---|---|---|
| Application messages kept (recall) | 72/72 | 72/72 |
| Non-application messages shown as opportunities | 8/14 | 0/14 |
| Event type correct | 93.4% | 96.7% |
| Program acceptances shown as job offers | 2/3 | 0/3 |
| Journeys split across opportunities | 7/28 | 2/28 |
| Opportunities merging different journeys | 2 | 1 |
| True endings missed (not even proposed) | 2/12 | 0/12 (11 verified, 1 proposed) |
| True-active applications wrongly closed | 1/14 | 0/14 |
| Real offers kept | 3/3 | 3/3 |
| Review "needs you" / all items | 19 / 152 | 18 / 134 |

Broader private corpus (895 Claude-labelled messages, owner confirmation pending), Milestone 1 to now:

| Measure | M1 | Now |
|---|---|---|
| False opportunities (of 216 non-applications) | 6 | 3 |
| Precision of pipeline entries | 98.8% | 99.4% |
| Recall of labelled applications | 99.4% | 96.2% |
| False offers shown / real offers kept | 0 / 8 of 8 | 0 / 8 of 8 |
| Active applications | 158 | 137 |

The recall drop is a definition change, not lost applications: 19 corpus-labelled "applications" are event registrations, session reminders, third-party recruiter-contact notices and an auto-reply, which are the kind of message the owner listed as false opportunities. The corpus labels were not edited to hide this.

## Verified against Gmail and in the browser
- Each fixed case was read against its real message (read-only). One October NVIDIA message the owner had earlier corrected to "rejection" is a receipt ("your application … has been received"); the owner agreed it was mislabelled. Programme acceptances name a programme and no job. Two classifier mistakes were found this way and fixed (an employer's interview invitation classed as an event; a student's own apology proposed as a rejection).
- Browser (account 1, localhost:3000): Today shows the real Harvey interview once, one Kleiner Perkins assessment, 18 need review. Pipeline: 27 active / 95 quiet / 3 accepted / 62 closed / 19 programs and events; Break Through Tech sits under programs as Accepted; Kleiner Perkins, NVIDIA 2027 Systems Software, Claude Corps Fellow (Rejected, under programs) and SLAC (one accepted application) each appear once. Review's first item was a false "mixed cycles / offer" card for Break Through Tech; it was fixed and the card is gone (the next item is a real ambiguity between two Alcon applications).

## Data integrity
139 corrected rows before and after. Exactly one changed: the NVIDIA type correction (rejection to applied), with the owner's explicit approval, through the product's own edit path (a superseding label row is appended), backup `~/.opportunity-inbox-sealed/nvidia-1a151c21-correction-backup.json`. The other 138 are identical (`scripts/integrity-check.ts compare`). All stamps touched uncorrected rows only.

## Gates (final run)
lint clean, tsc clean, unit tests pass, `eval:gate` pass, `bench:lifecycle:check` pass, `next build` pass, e2e keyword and sweep pass.

## Defects that remain (for the independent audit)
1. **Validation is not independent.** Labels are Claude's; the set is development data now. Use `docs/validation-workflow.md`; draw a fresh set before any accuracy claim.
2. **Harvey**: 2026 and 2027 are separate applications, but thread-spanning replies (an out-of-office, a November reply) still land in the 2026 group, one journey is flagged as merging H26 and H27, and a few role strings carry an inherited "Summer 2026" label.
3. **Stanford vs SLAC**: the two February receipts for the same internship still form a separate "Stanford" application from the SLAC one (different employer names, no shared thread).
4. **Two stored-type mismatches on the frozen set**: a HackerRank invitation typed interview instead of assessment (sender domain is the employer's), and a "Thank you for applying" typed assessment inside Kleiner Perkins.
5. **Corrected rows are authoritative and not re-derived**: the JPMorgan receipt rows carry the owner's company correction, so they get no stamped evidence; identity for them relies on stored subjects.
6. **Class detection is wording-based** and was tuned while inspecting this mailbox; false classes are possible on mail the author has not seen (three were found and fixed during this milestone).
7. Alcon (externship vs 2027 internship) is a genuine ambiguity surfaced in Review.
8. The corpus still lists 3 "Unknown company" false opportunities.
9. Account 2 is not browser-verified; the 15 historical corrected rows are unchanged (the repair token awaits separate authorization; 7 more rows await the owner's decision).

## Rollback
- Whole milestone: `git revert --no-edit 691e66c..HEAD` (or check out 691e66c), restart.
- Behaviour switches in `.env.local`: `ENTRY_POLICY=off`, `IDENTITY_V3=off`, `REVIEW_PRIORITY=off`, `DECISION_ENGINE=off`.
- Stored signals: `scripts/stamp-message-evidence.ts <sub> --rollback <backup file>` (backups in `~/.opportunity-inbox-sealed/`).
- NVIDIA correction: restore the backed-up value if the owner changes their mind.
