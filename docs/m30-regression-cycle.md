# Regression-audit cycle report (from `5cb4864`): evidence-to-journey completeness

Everything here is on the owner's live account, read-only Gmail, targeted stamps with backups (no full restamp), and DEVELOPMENT evidence: the audited cases are regressions, not independent holdout evidence. `READER_INPUT=parts` stays OFF; the blind holdout was not used.

## Root causes found and the mechanisms that fix them
| Audit finding | Root cause | Mechanism (general) |
|---|---|---|
| Programme invitations/acceptances/sessions/completions vanished (10 of 123 removed messages) | a message class meant "resolved", with no destination: model-only entry demotion ran before any programme routing, and Review filtered every `class:*` possible as done | **Disposition contract** (`lib/recruiting/disposition.ts`): every message outside a journey has an explicit disposition (prospecting / noise / review) and "violation" = a message whose own facts put it in a journey. `attachProgramEvidence` (`lib/recruiting/entry-policy.ts`) routes a programme's own mail (sessions, cohort calendar, welcome, progress, completion, acceptance) to that programme's journey as evidence: never a job stage, never demoted. Programme journeys are never entry-demoted; campaigns are demoted one by one (`demoteCampaigns`) |
| Crescent receipt stored as CBRE | the backfill only touched role-less rows; a specific-but-borrowed role never got `role:named`, and sentence matching broke on soft-wrapped lines | `namedRole` is sentence-local with joined wrapped lines, markdown/long-name tolerant; `applyNamedRoles` lets a receipt's own named opportunity outrank a copied or contradicting role; borrowed-role receipts were re-derived by targeted refresh |
| Programme acceptance advanced a job stage | `neutralizeClassed` omitted the class; acceptances joined job receipts | acceptances get their own journey (`isProgAcc` isolation), programme names identify journeys (`program:named`), programme kind from evidence, jobs named "Program" stay jobs (JOB_TITLE guard) |
| Coca-Cola rejection hidden | terminal promotion needed an already-known company | `employerNamed` fact ("position with X", "interest in X"; platforms and titles rejected, per-sentence), `applyNamedEmployer`, decisive near-misses promoted with the named employer |
| Reattachment moved one message | no conversation unit, no tolerance for messages that precede the application's first mail, forward anchors poisoned grouping | `identity:attach:<anchor>` (deferred placement in the anchor's group), conversation unit (same thread + sent replies by subject/time), orphan consolidation, terminal-fragment reconciliation |
| Questions Gmail already answers | resolvers read only some stored signals | investigator resolvers: type-by-facts (receipt, ending sentence, withdrawal, assessment platform, dated assessment/interview), stale-goodbye, employer-by-corroboration, company-by-message, company-alias, membership-by-thread/statement, assessment-by-vendor, update-in-thread, program-routed/program-evidence-routed, identity-by-journey; confidence doubts (no reason text) are covered by the same facts; every resolution is listed on the Review screen with its reason |

Mistakes made and fixed during the cycle (each caught by the regression measures, not by tests alone): a programme anchor named only by its host ("Salesforce") swallowed the employer's entire job process (assessment, interviews, offer, a 2026 rejection) as "programme evidence" until employer-hosted anchors were required to carry their own programme name and rule-read employer-process messages were excluded from attachment; a conditional ("failing to attend will result in the withdrawal of your application") was read as a withdrawal; "Congratulations! You have been selected … coding assessment" was classed as a programme acceptance; a platform name (ZipRecruiter) was extracted as an employer; an interview reminder was classed as an event.

## Before (`5cb4864`) -> after, live account
| Measure | before | after |
|---|---|---|
| Journey-level invariants (scripts/journey-invariants.ts: Harvey, SLAC, Code in Place, Salesforce, BAL, Alcon, HeadStart, CTI, Coca-Cola, 4 Project Destined receipts, 8 restored messages, no programme evidence advancing a job stage) | 5 pass / 21 fail | **25 pass / 1 fail** (SLAC/Stanford receipts) |
| Four Project Destined receipts | ICSC, Amazon as jobs; Crescent stored as CBRE (two CBRE journeys, none for Crescent) | four journeys, each named (ICSC, Amazon Affordable Housing, CBRE, Crescent), programme lane for the Bridge programmes |
| Messages that wait outside a journey although their own facts put them in one (violations) | 4+ (programme acceptances, programme evidence, an own ending, an own receipt) | **0** |
| Review needs-you / housekeeping / weak | 2 / 66 / 180 | 2 / 44 / 158; resolved automatically with a stated reason: 43 (listed, not hidden) |
| Pipeline (active / quiet / accepted / closed / programs and events) | 24 / 86 / 2 / 75 / 16 | 23 / 82 / 2 / 74 / 27 (programme journeys are now represented: ICSC Bridge, NSF workshop, Code in Place, CRE Fundamentals, CTI Launch, HeadStart, ...) |
| Frozen validation set: recall / false opportunities / split journeys / merging opportunities | 72/72, 0/14, 1, 0 | 72/72, 1/14 (a Slack workspace invitation inside a programme journey), 2, 1 |
| Corpus (provisional labels): recall / false opportunities / precision / real offers kept / false offers | 83.6% / 3/216 / 99.3% / 8/8 / 0 | 83.2% / 20/216 / 95.5% / 8/8 / 0; **12 of the 20 are programme evidence or programme journeys** (the provisional labels have no programme lane), 8 sit in job journeys |
| Corrected rows | 138/139 identical | 138/139 identical (only the owner-approved NVIDIA change) |

Precision on the provisional corpus fell by design: programme evidence is now represented, and those labels call it non-application. This is the audit's own point ("message-level recall is not a release claim"); the independent holdout must label by lane.

## What is NOT done (honest limits)
- **The current Important/Housekeeping set is not at zero questions.** From 68 items it is 46 (2 + 44). The remaining 44 are low-confidence plain updates and doubts whose stored facts do not yet cover them (Learnwleo, Alcon logistics, Apple, Kleiner Perkins aliases, Salesforce/BAL, assessment vendors for named employers, ...); each has a listed reason and is answerable from Gmail in principle. The two Important cards (an Adobe hackathon registration outcome, an Electronic Arts Forage simulation) are still asked.
- **SLAC/Stanford:** two Stanford receipts and one Unknown-company message stay as separate active fragments next to the correctly Withdrawn SLAC journey (the SLAC receipt's role is borrowed from continuity; no message ties them).
- **BAL:** the first BAL message carries the owner's "Looks right", so it was not reinterpreted (confirmed readings are authoritative); the second BAL message is attached to Salesforce.
- **Edmund forward** (a forwarded message about someone else's inquiry) is not handled. Weak suggestions (158) remain an unresolved pool with dispositions (157 prospecting, 65 noise, 164 genuinely unclear by class) rather than hidden.
- The 123-message removal set itself was not replayed id by id (the audit gave counts and ten ids); the ten meaningful messages are asserted individually in the invariants and the rest are the class-excluded campaign/notice mail (disposition prospecting/noise).
- Nothing here is independent accuracy evidence.

## Rollback
`PROGRAM_EVIDENCE=off`, `NAMED_ROLES=off`, `VENDOR_RELATIONS=off`, `INVESTIGATE_REATTACH=off`, `INVESTIGATE=off`, `ENTRY_POLICY=off` (env, restart). Stamps: `scripts/stamp-message-evidence.ts --rollback <backup>` (backups in `~/.opportunity-inbox-sealed/`, newest `…1795312030840`).
