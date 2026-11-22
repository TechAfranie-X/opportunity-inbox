# Journey-correctness milestone (from audit of `1089df4`)

Development evidence on the owner's live account (read-only Gmail, targeted stamps with backups, no full restamp). The audit's 20 histories are regressions, not independent evidence; the 123-message holdout has been evaluated and is development data from here on. `READER_INPUT=parts` stays OFF.

## Mechanisms (general, no employer-specific rules)
| Audit root cause | Change |
|---|---|
| Programme lifecycle flattened to job stages | `lib/lifecycle/program.ts`: invited / accepted / enrolled / participating / completed / rejected / withdrawn from `program:<stage>` facts; `Opportunity.programState`; Pipeline shows it ("In progress", "Enrolled", ...); a completed programme closes (`closedBy: completed`); programme completion wording tightened (a reminder, an earlier level or an onboarding step is not completion; finishing a level and being invited to the next is advancement); "You're in the X Academy" and "a spot opened in X" are acceptances |
| Attachment ignored hard constraints | Same-thread evidence outweighs a soft hiring-unit signal, a subject programme type and a wording difference in the role (`relation`); a programme anchor is never a reply inside a job's thread; tokens that appear in >12% of one sender's subjects identify nothing; shared platform hosts (Greenhouse, iCIMS, ...) are never a programme host; administrative mail never attaches as programme evidence; acronym and same-institutional-host alias evidence (TMCF / Thurgood Marshall, SLAC / Stanford); `fragmentMoves` consolidates one journey split under several names (distinctive-role words, compatible employers, no receipt-vs-receipt, no owner-corrected event moved) |
| Own-fact messages lost before routing | refine's "programme domain" and "weak sweep" exclusions no longer drop a message whose facts are a programme acceptance/stage, a receipt or an ending |
| False-active journeys | the reader's own decline (`student:declines`, outbound facts, stamp mode `--outbound`) ends the application (Alcon 2027); an externship whose host thanks the reader for the week is completed |
| Review/Today ignore source | `awaiting:them` fact (the sender will act next and asks nothing) suppresses reply actions and retypes the message (Harvey); no "No response yet" nudge for a programme the person is in; `immaterial-update` resolver; hackathon-registration updates, Forage simulations, "Apply by / N days left" subjects, incomplete-application nudges typed from facts |
| Scorer | `holdout-score.ts`: refuses to score when any label type is unmapped (seven receipts once vanished), counts programme-selection-as-offer apart from semantic false job offers, and promotion needs absolute floors (>=85% exact, zero false job offers/endings, 100% job-offer recall, >=90% ending recall) plus the old relative gain |
| Stamp modes | `--bulk-senders` / `--modeled-unclassed` matched `identity:class:*` as if it were a message class and silently skipped rows; fixed (`"class:`) and rerun |

## Before (`1089df4`) -> after
| Measure | before | after |
|---|---|---|
| Journey regressions (scripts/journey-invariants.ts; audited histories) | 26 checks, 25 pass | 41 checks, 41 pass |
| Strict histories of the audit's 20 that the product now gets right (by the invariants; independent re-check needed) | 4 pass | Harvey 2026/2027 (+Today waits), Salesforce (job separate from accelerator and 2026), Alcon 2027 declined, Alcon externship completed, SLAC one journey, Project Destined ICSC clean + participating, CRE Fundamentals, Code in Place, LILO, Last Mile, Neuralink/Claude, PayPal apart from TMCF, Coca-Cola, Tiffany x2 |
| Today | asks to reply to Harvey | "Nothing needs you today" |
| Review needs-you / housekeeping / weak | 2 / 44 / 158 | 0 / 38 / 136 (56 doubts resolved with a stated reason, listed) |
| Frozen validation: recall / false opps / split / merge | 72/72, 1/14, 2, 1 | 72/72, 2/14 (Slack invite, Futureforce check-in), **0**, **0**; type correct 96.7% |
| Corpus (provisional labels): recall / false opps / precision | 83.2% / 20/216 / 95.5% | 83.4% / 17/216 / 96.1% (9 of the 17 are programme evidence) |
| Offers kept / false offers; false rejections | 8/8, 0; 0 | 8/8, 0; 0 |
| Corrected rows | 138/139 | 138/139 (owner-approved NVIDIA change only) |
| Gates | | tsc, lint, 807 tests, eval gate, lifecycle bench, build, e2e (keyword + sweep) all pass |

Validation "truth-active wrongly closed 3/14" are stale labels: Alcon externship (completed), Alcon 2027 (declined by the student), SLAC (withdrawn), all confirmed closed by Gmail in the audit. The frozen file is not edited (its hash is pinned).

## Browser (localhost:3000, account 1)
Today: nothing needs you. Pipeline: programmes show their own states (ICSC, Code in Place, CTI, LILO, Futureforce: In progress; Slack, Udacity, Deloitte: Enrolled; Break Through Tech: Accepted), PayPal Career Academy separate from the Leadership Institute, Alcon externship in Closed. Review: "Nothing important", 38 housekeeping, 136 weak, "Resolved automatically" list.

## Not done / limits
- Review is not at zero questions: 38 housekeeping items remain (low-confidence plain updates with no corroborating thread, assessment vendors for named employers, Salesforce Insiders invitations, Texas Instruments/RippleMatch identity). Each lists its reason; none is hidden or bulk-confirmed.
- Susquehanna Technology vs SGE Growth Equity discovery programmes are still merged into one journey (the evidence that separates them is subject-phrase only; no safe general rule was found).
- TMCF Leadership Institute has 4 active fragments, not one: three hold events the owner corrected, which are authoritative and never moved. Salesforce's calendar invitation for the job interview sits in the accelerator programme.
- "Stanford" is the display name of the merged SLAC journey (first event's name).
- The weak pool (136) is still shown as one list; dispositions are counted (scorecard) but not yet surfaced per message in the UI.
- Holdout scorer verified only on provisional references (the independent label file was not supplied); the promotion rule is untested against it.
- All numbers are development evidence on one mailbox; none is independent accuracy.

## Rollback
Env switches as before (`PROGRAM_EVIDENCE`, `NAMED_ROLES`, `INVESTIGATE_REATTACH`, `INVESTIGATE`, `ENTRY_POLICY`). Stamps: `stamp-message-evidence.ts --rollback <backup>` (backups in `~/.opportunity-inbox-sealed/`, newest `stamp-evidence-117880-1795358939708` and later).
