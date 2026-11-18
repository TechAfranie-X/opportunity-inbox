# Autonomous QA progress record (canonical)

Branch `mvp`. Updated 2026-11-18. "Implemented" = code and tests exist. "Verified" = how it was independently checked (unit / benchmark / stored replay / browser). Live Gmail and the second account in a browser were never available in this environment.

## Current metrics
- Tests 593/593; typecheck, lint, build, e2e (keyword and sweep modes) pass.
- Lifecycle benchmark (development): 56 pass, 1 known failure, 3 pending (was 34/23/3 at Milestone 1, 52/5/3 after Milestone 2). Held-out set: last run at Milestone 2 (grouping 100%/100%); not re-run since, release gate only.
- Known failure: G04 (stored-shape case: cancelled interview persisted as `interview_scheduled`, type confidence 0.4). New mail is read correctly by the ingestion fact (I01 passes); rows stored before this change are not re-read.
- Second account replayed read-only: 24 active -> 16 active. First account unchanged: 111 active / 64 closed.

## Architecture now (read path)
Gmail search (keyword; `DISCOVERY=sweep` optional) -> frozen rule reader + reliability layer (`lib/reliability/assess.ts`) -> **ingestion facts** (`lib/reliability/facts.ts`: cancellation, explicit deadline, generic results) -> stored events (metadata only) -> **evidence refinement** (`lib/lifecycle/refine.ts`: context gate, offers, entity cleanup, onboarding, kinds) -> Identity v2 grouping (`identity.ts`) -> lifecycle reducer (`reducer.ts`) -> actions / briefing / review.

## Second audit (S2-F01..F16)
| ID | Sev | Status | Verified |
|---|---|---|---|
| F01 wrong Gmail account | Crit | implemented `2ab821f` (`authuser=<connected address>`) | unit; browser (link shape only, no click-through) |
| F02 missed offers | Crit | **partly**: Allstate 2026 offer recovered (near-miss promotion). Summer 2027 offer message absent from stored data: unresolved, needs Gmail-side check / re-sync | unit; stored |
| F03 false Capital One offer | Crit | implemented (context gate) | unit; stored |
| F04 stale Allstate x2 | Crit | implemented (offer + entity merge + onboarding) | unit; stored |
| F05 Futureforce active+closed | High | implemented (course sessions excluded) | unit; stored |
| F06/F07 mock interviews, newsletters | High | implemented | unit; stored |
| F08 Sodexo role/outcome | High | **open**: facts live only in bodies that are not stored; needs body re-read at ingestion | - |
| F09 Two Sigma | High | implemented | unit; stored |
| F10 Ramp split | High | implemented | unit; stored |
| F11 Robinhood | High | implemented (narrow: finance employers' job mail kept) | unit; stored on both accounts |
| F12 Today "caught up" | High | implemented | code only (no waiting reviews on first account to see it live) |
| F13 satisfied screening as rejection | High | implemented (onboarding after offer) | unit |
| F14 fragments as entities | Med | implemented | unit; stored |
| F15 search duplicates | Med | follows from grouping | stored |
| F16 active count | Med | follows from the above | stored |
| Taxonomy TMCF/SYNC | - | implemented (`Opportunity.kind`, label); still counted in totals | unit |

## First audit (F-01..F-14) — tracked by benchmark case ids
F-01 G01 re-apply next cycle; F-02/F-09 G02 season merge + offer actions; F-03/F-09/F-11 G07 expired assessment; F-04 G08 expired after reminders; F-05/F-10 G03 two roles one thread; F-06/F-11 G04 cancelled interview (ingestion fixed; stored-shape case known-failing); F-07 G05 externship vs internship; F-08 G09 non-recruiting assessment; F-10/F-14 G06 two receipts one thread. F-12 and F-13 are not mapped to a benchmark case in the repository (the original report text is not in the repo): **status unknown, to be mapped when the report is available**. All mapped cases pass except G04.

## Commits (all pushed to `mvp`)
f9ba482 Milestone 2 · 2ab821f Gmail routing · d7bafd2 refinement layer · 9958354 kinds + Today copy · 6a40fbd onboarding + tracker · (this record's commit adds ingestion facts)

## Next executable tasks
1. Accepted/completed lifecycle state (an accepted offer with onboarding should leave "Offer: needs decision", show as accepted).
2. Count only job/internship kinds in pipeline totals; filter by kind.
3. Contradiction review item (missing offer, active/closed duplicates) and Today priority.
4. Sodexo-class: persist small derived facts at ingestion (role from body) with a fresh-extraction pass.
5. Mine duplicate stored rows (same message twice) and verify idempotency on real data.
6. Held-out run at the release gate; browser pass on both accounts when access exists.

## Blockers / limitations
- No browser session for the second account; no live Gmail access: real-account verification for account 2 is stored-data replay only.
- Summer 2027 Allstate offer: cannot determine from stored data whether it was never fetched.

## Acceptance criteria (release for external student testing)
All critical/high audit findings fixed or explicitly blocked; offers detected and attached; zero newsletter offers; grouping benchmark at target; links verified in a multi-account browser profile; held-out gate run once; both accounts browser-tested.
