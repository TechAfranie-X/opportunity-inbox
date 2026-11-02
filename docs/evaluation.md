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
