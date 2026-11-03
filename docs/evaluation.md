# Evaluation and ground truth

Predictions and human labels are separate records. A correction never overwrites what the system predicted.

## Datasets

| Dataset | What it is | May we tune on it? | How it is reported |
|---|---|---|---|
| **DEV-RANDOM** | Uniform random sample of the development mailbox (whole mailbox window, not just recruiting-looking mail). Frozen on creation. Failed fetches stay in the set; there is no "replace". | It is the honest development metric: look at aggregate numbers, do not fit rules to its individual failures. | "DEV-RANDOM" banner |
| **DEV-CHALLENGE** | Curated hard and regression cases (ATS/vendor mail, ambiguous employers, reschedules, marketing noise, several roles at one company...). | Freely. | "never a generalisation estimate" banner |
| **BLIND** | A mailbox the extractor was never developed against. | No. The first run is the official result. Later runs are recorded as contaminated. | "BLIND (official)" or "CONTAMINATED" |

Label provenance: `dev_human`, `blind_human` (fresh, made from the raw message with predictions hidden) count toward headline metrics.
`user_correction` and `legacy_reconstructed` (migrated from mutable rows) are regression / DEV-CHALLENGE material only.

## Privacy

Raw message bodies exist only in `~/.opportunity-inbox/eval/` (directories 0700, files 0600), outside the repo and outside Postgres.
Product serving code never reads that directory. Postgres holds labels, dataset membership and run logs, which contain no bodies.
`npm run eval:purge -- --yes` deletes the local snapshots (add `--include-db` to drop the dataset records too).

## Workflow

```bash
npm run eval -- status
npm run eval -- snapshot-random --name dev-random-1 --n 200      # frozen on creation
npm run eval -- snapshot-challenge --name dev-challenge-1 --ids id1,id2,...
npm run eval:label -- --dataset dev-random-1 --labeler me        # local page, predictions are not loaded
npm run eval -- export-tasks --dataset dev-random-1 --out tasks.jsonl   # for a second reviewer (contains email content)
npm run eval -- import-labels --dataset dev-random-1 --file labels.jsonl --labeler reviewer-1
npm run eval -- export-labels --dataset dev-random-1 --out labels.jsonl # content-free
npm run eval -- run --dataset dev-random-1
```

Label JSONL, one object per line, no content and no predictions (extra keys are rejected):
`{"gmailMessageId":"…","field":"company","value":"Acme","labeler":"reviewer-1"}`

## Labeling guide

Label from the message alone, as the reader would understand it. Do not look at what the product shows.

- **is_recruiting**: yes if the message is part of the reader's own job/internship process (application, outreach to them, assessment, interview, offer, rejection, status). No for newsletters, promotions, program ads, receipts, codes.
- **type**: `applied` application received; `recruiter_outreach` a recruiter reaching out; `assessment` an assessment assigned; `assessment_completed` submission acknowledged; `interview_invite` asked to schedule; `interview_scheduled` a confirmed time; `follow_up` a nudge; `status_update` generic update whose meaning is unclear; `offer`; `rejection`; `withdrawn`; `user_reply` the reader's own message. Use `unknown` when you cannot tell.
- **company**: the employer the opportunity is with. Never the ATS or platform (Greenhouse, Workday, HackerRank...), never a recruiter's name. `unknown` if the message does not say.
- **role**: the role as stated. `none stated` if the message names none, `cannot tell` if it is ambiguous.
- **opportunity**: any short id you choose; reuse it for every message about the same application. Two applications to the same company for different roles are different opportunities; a new application after a rejection is a new opportunity.
- **stage after this message**: applied, recruiter, assessment, interview, offer or closed.
- **date**: a deadline or scheduled time stated in the message. After a reschedule, the newer time. `none stated` if there is none.
- **actionable / urgency**: does the reader need to do something, and how soon as of the dataset's as-of date (shown on the page)? `today` means due or needed today or already overdue.

Leave a message unlabeled (skip) rather than guess; unlabeled messages are reported, not scored.

## Abstention policy

`lib/recruiting/policy.ts` holds the thresholds. Each field (type, company, role) has a `reviewBelow` line (shown, but flagged) and an `unknownBelow` line (withheld, reported as unknown). `urgentMinConfidence` keeps an uncertain action off the overdue/today buckets: it is downgraded to "worth a look" and marked uncertain, never hidden.
Serving reads `OPPORTUNITY_POLICY` (JSON, e.g. `{"fields":{"company":{"reviewBelow":0.5}},"urgentMinConfidence":0.5}`); unknown keys and out-of-range numbers are ignored.

The defaults are **not tuned**. They flag only clear doubt (the employer where independent evidence disagrees or is missing) and withhold nothing. Stricter values are chosen from the DEV-RANDOM risk-coverage table (`npm run eval -- run --dataset dev-random-1`) and then frozen before the BLIND run.

Company confidence today is a second opinion: the existing rules still choose the value, and the evidence-based resolver (`lib/recruiting/entity/`) says how far to trust it. The resolver replaces the rules only after `eval run --shadow` shows, on DEV-RANDOM, no more confident-wrong answers and no loss of exact match.

## Corrections as labels

Saving an edit, "Not recruiting", "Looks right" or "Undo my edits" in the product appends label rows (source `user_correction`) against the prediction that was on screen (`labels.prediction_id`). The serving overlay (`recruiting_events.correction`) is unchanged.

- Only fields the person changed, reverted or explicitly confirmed are labeled. An untouched field is unlabeled, not "correct".
- A repeated identical statement adds nothing; a changed mind adds a new row.
- Nothing learns from these rows yet. They exist so corrections can later be evaluated and used for improvement.
- They are not fresh human ground truth (the person saw the prediction), so they never count toward DEV-RANDOM or BLIND headline metrics.

`npm run eval -- migrate-legacy-corrections [--dataset <dev-challenge>]` converts corrections made before this existed into `legacy_reconstructed` labels (idempotent). Their original prediction cannot be proven, so they are regression and DEV-CHALLENGE material only.

## Milestone log: generalization 1 (extractor 2026.11.1-generalization)

**Label revision `semantics-rev-1`.** After the baseline, the product definitions were fixed (clear rejection → rejection; a
confirmed interview with a specific time → interview_scheduled; a clear offer letter → offer; generic hackathons, webinars,
bootcamps, newsletters, training programs and ads are not recruiting; automatic out-of-office replies are context). Labels that
contradicted those definitions were **superseded, not edited**: new `dev_human` rows with labeler `semantics-rev-1`, newest wins,
the originals stay in the table. 8 messages changed: 2 rejections typed `offer`, 1 confirmed-time interview typed `interview_invite`,
1 offer letter typed `status_update`, 1 type withdrawn to `unknown` (no definition decides it), and 3 messages turned into
`is_recruiting = false` (an out-of-office reply and two training-program ads). The revision was made after the baseline predictions
had been seen, so dev-random-1 is no longer a hidden-prediction set for these 8 messages. The label-set fingerprint printed with
every report (`label set …`) tells you which revision a number was scored on. Compare runs only when it matches.

**How to read the numbers.** The recorded baseline (label set before the revision) is not directly comparable to a run on the
revised labels. The "re-scored baseline" row is the *old* extractor on the *new* labels, so the extractor's own change is the
difference between that row and the new one. The failure analysis that shaped this change used dev-random-1, so the new
numbers are optimistic by construction. Only BLIND measures generalization.

**Design decisions** (each is a general invariant with a test in `lib/recruiting/generalization.test.ts`):
- The company is chosen by the evidence resolver alone (the old rule-based guess no longer decides it). Invariants I7–I11 in
  `entity/resolve.ts`: a domain is an identity key and the fuller name the message uses wins; a name the sender block asserts but the
  text never mentions is weaker; an intermediary's own brand is never the employer; a programme descriptor is not part of the employer;
  infrastructure hostnames are not tenants. Vendor learning now uses strong content evidence only.
- A rejection is detected structurally (negation × progression verb × a decision about the candidacy) instead of by phrase list.
  The earlier "polite opener outranks the rejection" hypothesis was wrong: tiers already put terminal language first; the wording
  simply was not covered.
- Weak hiring vocabulary needs a hiring process behind it; an event/course registration without a candidacy is rejected as
  `non_hiring_event`; automatic replies are rejected as `auto_reply` (subject or body).
- Later mail from a named person at an employer who already wrote about a candidacy is linked as a flagged `status_update`
  (`known-contact-continuity`); bulk/role mailboxes and event invitations never are.
- Role falls back to a labelled field ("Requisition:", "Position:") and then a programme name when there is no job title.
- Evaluator additions: employer **overreach** (naming an employer the labeler could not tell) and the label-set fingerprint.

## Milestone log: generalization 2 (extractor 2026.11.2-evidence)

**Dataset roles.** dev-random-1 and validation-1 are both development data from here on (validation-1 was looked at and used to
find failure classes). Neither number below is evidence of generalization. validation-2 is the only fresh check for this milestone.

**Diagnosis (validation-1).** Event-type errors: (a) first-match tiers, so a generic subject outranked a specific task stated in the
body; (b) over-broad weak cues ("interest", "follow-up capital", "successfully applied"); (c) lexical gaps (plurals, a confirmation
and a time in one sentence); (d) taxonomy ambiguity: an expired request is a status line, not an assessment. Confidence was a tier
constant, so it did not predict correctness. Role errors: a keyword vocabulary instead of the syntactic slots senders write roles in,
and no use of thread context. False positives: "application", "interest" and "registration" vocabulary without employment as the
object (prizes, conferences, receipts, programme-opening broadcasts).

**Architecture.** Deterministic, evidence-combining; a model-assisted classifier was rejected (new dependency and privacy surface,
and the errors were evidence-combination and coverage problems a model would not have fixed more simply).
- `extract.ts`: every rule that fires is a cue with a weight; cues for a type combine; strong specific types outrank generic wrappers
  (nudge/confirmation/status line); confidence is the winner's evidence less the rival's.
- `role.ts`: frame-based span extraction with plausibility checks; roles inherited from the thread, or from the employer's only role
  within 90 days.
- `signals.ts`: employment must be the object; application portals, receipts, opening broadcasts and event selections are not hiring.
- Company resolution and grouping were deliberately left alone.

Changed by decision, not by evidence alone: an expired request is now a `status_update` (the labeler did so consistently); the Today
nag for an expired assessment is gone because there is nothing left to do.

Open label-policy question: "position has been filled / no longer reviewing applicants" notices were labeled No by the labeler but the
extractor (by design, since before this milestone) treats them as closing notices of the reader's application.
