# Journey trust and correctness milestone (from the independent audit of `8a6c6d0`)

Development evidence only. The 44 audited histories are known cases now; passing them is not independent accuracy. Gmail stayed read-only; no full restamp; user corrections untouched (139 corrected rows, only the owner-approved NVIDIA row differs from the earlier baseline); `READER_INPUT=parts` stays OFF.

## Root causes found and fixed (general mechanisms)
| Audit finding | Cause | Fix |
|---|---|---|
| Waymo, Rippling merged; Sigma/Tenstorrent/Arcesium/Capstone mega-merge | (a) my own earlier "same-thread role wording difference = generic" rule let two explicit receipts for different roles join one thread; (b) a same-host receipt rule treated `greenhouse-mail.io` as an institutional host | hard vetoes in `lib/lifecycle/identity.ts relation()`: two organisations named in the messages' own words, or two explicit receipts naming different positions, are a conflict that no thread/sender/wording overrides; shared ATS/assessment hosts widened; host rule refuses to cross named employers |
| Terminal evidence left an active receipt sibling (BlackRock, Fidelity, Arcesium, Sigma) | role-less / differently-named terminal fragments; owner-corrected events were never regrouped | `openSiblingTerminalMoves` (a role-less ending joins the ONE compatible open application at the employer; none or several = not guessed, nothing closed by age); `fragmentMoves` may regroup corrected/confirmed events (fields unchanged; a person-made link never moves); two receipts from different threads never consolidate; exact long-role equality allows an unknown-employer fragment |
| Programme lifecycles flattened | no terminal/removed/award states | `lib/lifecycle/program.ts`: + removed (Code in Place, Break Through Tech), awarded (Last Mile approval and payment), completed externship; programme kind for role names that are programmes; awards stay scholarships; acceptances are never job offers; programme-stage mail is never demoted as a campaign or notice |
| Today: 54 of 55 unsupported | follow-ups/check-ins/"quiet" suggestions generated from elapsed time | removed (rollback `ELAPSED_NUDGES=on`); new `program_deadline` action from a programme's own dated ask (ICSC quizzes due Nov 23); Harvey stays "waiting" (`awaiting:them`) |
| ICSC deadline, Code in Place removal, Break Through Tech withdrawal, Last Mile award missing | the sweep reads a programme host's mail and remembers coursework/quiz/removal mail by id only | `scripts/recover-programme-evidence.ts` (dry-run default, insert-only, rollback by id): host mail since the journey began that names the programme (>=60% of its words), not campaigns/newsletters, assigned to the ONE best-matching programme |
| HubSpot histories absent | not a classifier bug: the 365-day mailbox window starts after those applications ended; messages dated Sep-Nov 2025 were never read | `scripts/deepen-history.ts` (dry-run default, insert-only, rollback by id): for employers with in-window evidence near the window start, reads that employer's older mail with the product's own rule reader and keeps stage events of that employer only. 66 events / 30 employers stored (8 CodePath rows removed as course noise); HubSpot USA receipt+rejection and Ireland receipt now exist |
| JPMorgan HackerRank completion, Vanderbilt/Cisco receipts in Weak | assessment-platform mail without an employer; receipt wording not recognised ("Thanks for your submission", entity-glued text) | `recoverVendorEvidence`; broader own-application wording; model-found receipts whose text states the application are not demoted |
| Review/Weak asks about resolvable mail | hard negatives unclassed | wording families for job-match notices, account verification/password mail, call-to-apply subjects, dated programme session confirmations; an ending a message itself states is not an "offer ended" contradiction |
| Holdout scorer | (done in the previous milestone) | unchanged |

## Measured on the live account (development evidence, not independent)
| Measure | before this milestone | after |
|---|---|---|
| journey regression script (audited histories + new cases) | 41/41 | 53/53 |
| Today actions | 55 (1 supported) | 2: KP assessment, ICSC coursework due Nov 23 (both evidence-backed) |
| Review needs-you / housekeeping / weak | 0 / 38 / 136 | 0 / 40 / 89; resolved automatically 63 listed; resolved by class and not asked 313 |
| Frozen validation: recall / false opps / split / merge / type | 72/72, 2/14, 0, 0, 96.7% | 72/72, 2/14, 0, 0, 96.7% |
| Corpus (provisional labels): recall / precision / false offers / real offers kept | 83.4% / 96.1% / 0 / 8 of 8 | 82.8% / 95.0% / 0 / 8 of 8 |
| Gates | | tsc, lint, 814 tests, eval gate, lifecycle bench, build, e2e (keyword + sweep) pass |

Validation shows "truth-active wrongly closed 4/14": Alcon externship (completed), Alcon 2027 (declined), SLAC (withdrawn) and Break Through Tech (admission withdrawn) are all closed correctly by Gmail; the frozen labels are stale and the file is not edited.

## Browser (localhost:3000)
Today: one task (Project Destined programme task due Nov 23) plus the KP assessment; no follow-up/check-in lists. Pipeline: programme cards read Completed / Awarded / Removed / In progress / Enrolled; Code in Place Removed, Last Mile Awarded, Alcon externship Completed. Review: "Nothing important", 39-40 housekeeping, 89 weak, "Resolved automatically" list.

## Not done / limits
- Susquehanna's two programmes are still merged (only subject phrases separate them).
- TMCF still has several fragments: some owner-corrected events remain in role-conflicting groups; the consolidation now regroups corrected events only when roles/employers are compatible.
- The CRE Fundamentals session confirmations (sent through a scheduler) still wait among the weak items; one RippleMatch recommendation rides inside the eBay journey when an unknown-employer fragment is consolidated.
- Housekeeping is 40, not 0: low-confidence plain updates and a few identity doubts remain, each with a listed reason; none was hidden or bulk-confirmed.
- Deepening reads 270 days before the 365-day window for employers already evidenced; employers with NO in-window evidence stay invisible. Deepened rows are recoverable (`--rollback`).
- Receipt-only applications older than 60 days show as "quiet" in Pipeline, never as rejected; no expiry state exists for jobs.
- The 44 audited histories are known cases: a fresh independent evaluation is required before any accuracy claim.

## Rollback
`ELAPSED_NUDGES=on` (old Today nudges); env switches from earlier milestones (`PROGRAM_EVIDENCE`, `NAMED_ROLES`, `VENDOR_RELATIONS`, `INVESTIGATE_REATTACH`, `INVESTIGATE`, `ENTRY_POLICY`). Data: `recover-programme-evidence.ts --rollback <file>` and `deepen-history.ts --rollback <file>` (files in `~/.opportunity-inbox-sealed/`), `stamp-message-evidence.ts --rollback <backup>`.
