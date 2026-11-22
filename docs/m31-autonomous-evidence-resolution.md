# Autonomous evidence resolution (Review is an exception, not a chore)

Development evidence only. The disposition of all 128 items was checked against their Gmail sources by the implementer (read-only), which is NOT an independent validation; the per-message table (subjects, ids) lives in the private package `~/.opportunity-inbox-validation/m31-items/` and is not in the repository. Gmail stayed read-only, user corrections untouched (139 corrected rows, only the owner-approved NVIDIA row differs), no full-mailbox restamp (targeted refreshes of exactly the affected ids, backed up), `READER_INPUT=parts` OFF.

## Why the 128 items reached Review (traced through classification, identity, investigation, lifecycle, Review construction)
| Shared systemic cause | Items | What the evidence said |
|---|---|---|
| Confidence turned into a question: a low-confidence type/company doubt on a message that already sat in a journey, or an identity "suggestion" about a plain update | 39 housekeeping | The message was explicit (an interview request, a receipt, a programme welcome, a reminder); nothing the student sees depended on the doubt |
| The message classes missed whole families, so ordinary mail looked like hiring mail to the model readers | most of 89 weak | job-match/recommendation digests (RippleMatch), event and webinar registrations, account/verification/setup mail, forwarded mail, a weekly digest, "how did your interview go" surveys, form receipts |
| "Started but not submitted" reminders (incomplete application, saved draft, "your application is waiting") read as applications/assessments | 20 | not applications: evidence of intent, never a stage |
| Programme mail did not find its programme: a three-letter acronym (CTI) was dropped as a token, a host's own programme name was treated as generic, model-typed programme mail was excluded as a "promotion", travel/logistics mail named the programme only in its subject | ~25 | all belong to a programme journey |
| Receipt wording not recognised ("your updated application has been received", "your application was sent to X", "Thanks for your submission"), and a platform that is itself the employer was excluded | 6 | real receipts |
| Review construction asked about anything the model doubted, and kept every unmatched message as a "Yes, it is recruiting?" button | all | the policy, not the evidence, created the work |

## What changed (general mechanisms; no employer-specific rules)
- **`lib/recruiting/autonomy.ts`**: every Review candidate is decided BEFORE a question exists: **handled** in its journey (support / stage / programme evidence, with the reason), **set aside** (campaign, recommendation, notice, event, survey, account mail, started-not-submitted draft), **unassigned** neutral evidence (states the student's own application or programme but could not be tied to ONE journey safely: kept, not pretended resolved), or an **ask**. Low model confidence alone is never an ask. An ask exists only for a consequential decision Gmail cannot settle (an unconfirmed ending, a conflict with the student's own confirmation, which of several applications an ending/stage belongs to) and carries three fields shown on the card: what is missing, why the existing evidence cannot answer it, what decision depends on it.
- **Review screen**: "Yes, it is recruiting" prompts are gone. Sections: genuine questions; Handled automatically (with reasons); Set aside (grouped, with reasons); Unassigned evidence (each with a small "add it" action for the rare case it is yours). Nothing is hidden: mail already explained by a class is listed as set aside too. The badge counts questions only.
- **Facts/classes**: new class `draft`; wording families for notices/digests/forwards/platform recommendations, event registrations, account and setup mail, form receipts, interview-experience surveys, itineraries; receipts ("application has been received/was sent"), a platform hiring for its own role; an ending the message states is never a draft or a notice; a programme acceptance into a NAMED programme even if it mentions recruiters.
- **Attachment**: programme mail attaches across hosts when it names the programme (acronyms kept; host-generic words only discount multi-programme hosts; company-less programmes stay company-less; model-typed programme mail attaches when it names its programme); a programme acceptance never counts as a job offer; a year-leading requisition number is not a recruiting cycle.

## Where the 128 went (implementer-validated against Gmail; before -> after)
| Disposition | Count |
|---|---|
| Questions for the student | **0** (was 39 housekeeping + 89 weak = 128 asked to judge) |
| Attached to the right journey and no longer an item (receipt/stage/programme evidence found its journey) | 18 |
| Handled in journeys with a stated reason (support 4, stage 9, programme 9, other 4) | 26 |
| Set aside with a reason (noise 30, campaigns/recommendations/notices 24, drafts 19, account/verification 4) | 77 |
| Unassigned neutral evidence (programme mail whose programme is not yet a journey; one receipt) | 7 |
Source check of those dispositions: of 128, 3 meaningful messages were wrongly set aside before the final fixes and 2 were fixed, leaving 1 form receipt (Uber candidate availability, no employer to attach to) set aside as account mail; 4 messages I judged as noise remain in journeys (a CodePath promotion in a false CodePath journey, a TI identity message, a Leadership Institute draft reminder, a ZipRecruiter receipt that is in fact a real application).

## Measured
| | before (d4afc39) | after |
|---|---|---|
| Review questions needed from the student | 0 important + 39 housekeeping + 89 weak (128 asked) | **0** |
| Source-resolvable questions among the 128 | 128 | **0** |
| Complete-journey regression script | 53/53 | 53/53 |
| Frozen validation: recall, split, merged, type | 72/72, 0, 0, 96.7% | 72/72, 0, 0, 96.7% |
| Corpus (provisional labels): recall / precision / real offers / false offers / real rejections settled | 82.8% / 95.0% / 8 of 8 / 0 / 57 of 59 | 82.0% / 89.0% / 7 of 8 / 0 / 57 of 59 |
| Gates | | tsc, lint, 820 tests, eval gate, lifecycle bench, build, e2e (keyword + sweep) pass |

Corpus precision fell because ~40 of its "false opportunities" are now programme evidence correctly inside programme journeys (the provisional labels have no programme lane; CRE Fundamentals sessions now complete that journey), and recall fell by 5 because started-not-submitted reminders are no longer treated as applications. The one "lost" real offer is a Salesforce Futureforce Tech Accelerator selection that the corpus labelled an offer: a programme acceptance is not a job offer; the job offer itself is intact.

## Browser (localhost:3000)
Review: "Nothing important to review", then Handled automatically 28 (26 of the 128 plus 2 new), Set aside 369, Unassigned evidence 7, each expandable with reasons. Today: one task (the ICSC coursework due Nov 23) plus the KP assessment. Pipeline unchanged in shape.

## Not done / limits
- The disposition check is mine, against Gmail, not independent; a fresh independent evaluation must test it (especially: nothing meaningful hidden in Set aside, and no wrong attachment among "Handled").
- Seven messages remain unassigned (programme mail for programmes that are not yet journeys, one receipt): neutral evidence, not resolved.
- Set aside is a large list (369), grouped and capped at 60 rows on screen; it exists for transparency, not for the student to work through.
- A few false journeys remain (CodePath, LeetCode-style platform journeys) that classification does not yet remove; a BTT orientation registration still sits in a Cornell journey.
- The raw doubt queue (`buildReviewQueue`) still exists for tooling; the product reads `buildAutonomousReview`.

## Rollback
Code revert, or the earlier env switches. Stamps: `stamp-message-evidence.ts --rollback <backup>` (backups in `~/.opportunity-inbox-sealed/`, newest `stamp-evidence-117880-1795378642438.json` and earlier this cycle).
