# Opportunity Inbox MVP

Opportunity Inbox is a candidate-side recruiting memory and control center. The primary object is the **opportunity** (a company and role), not the email. The app rebuilds recruiting activity from your Gmail into clean opportunity histories, shows what needs you now, and lets you see the whole lifecycle of each opportunity without digging through Gmail.

It answers three questions: what opportunities do I have, what needs my attention, and what am I at risk of missing.

## What is in the MVP
| Area | What it does |
|---|---|
| **Today** | A briefing: the one thing that needs you most, what is coming up, who has gone quiet, a pulse of your pipeline, recent changes. A quiet line links to anything worth checking. |
| **Pipeline** | Every opportunity by stage (applied, recruiter, assessment, interview, offer, closed). Select a row for details. |
| **Opportunity page** | The full history of one company and role: each email as a dated step, what is next, people involved, a link back to the email. |
| **Activity** | Everything that moved, newest first. |
| **Check these** (`/review`) | The short list the reader is unsure about (an unclear employer or event type). Fix it, press "Looks right", or hide it. Anything you settle leaves the list for good. |
| **Corrections** | Edit type, company, role or date; hide a non-recruiting email; close or reopen an opportunity; dismiss a suggestion; delete all your data. |
| **Sync** | Reads Gmail incrementally and resumably; refreshes on its own when data is over 6 hours old. |
| **Sample mailbox** | A synthetic mailbox for development and testing, no Gmail needed. |

## How the data flows
Gmail (read-only) -> a keyword search for recruiting-looking mail -> the rule-based reader -> structured events in Postgres (company, role, stage, dates, a link to the source email; **never the message text**) -> opportunities derived on read.

- **Incremental:** messages already read are not fetched again. Work is cut into whole threads, saved as it goes (newest first), and resumes after an interruption. When a request ends with mail still unread, the page continues by itself a bounded number of times.
- **Replies:** your own replies are metadata-only. Threads active in the last 30 days are re-checked on every sync so a reply you sent clears "reply to the recruiter". A reply to a thread that went quiet more than 30 days ago is picked up on the next full re-evaluation.
- **Role inheritance** (filling a missing role from the same thread or company) runs over stored events after each sync, so splitting a sync into chunks loses nothing.

## The evaluation embargo (read this)
A prospective evaluation of a newer reader (architecture v2) starts **2026-12-01** (`docs/prospective-evaluation-protocol.md`). To keep that evaluation valid, the product **does not fetch, read or show Gmail mail received on or after that date**. The cutoff is derived from the frozen evaluation constants, so there is one value. Today shows a notice once the date has passed.

- It changes nothing before 2026-12-01.
- After the evaluation is finished, set `EVAL_EMBARGO=off` in `.env.local` to read newer mail. Using the product on newer mail before then would end the evaluation window.
- The sample mailbox is synthetic and is not affected.
- Product work lives on the `mvp` branch in a separate worktree; see `docs/development-workflow.md`.

## Privacy
- Read-only Gmail scope; nothing in the mailbox is changed.
- Message bodies exist only in memory during a sync. The database holds extracted fields and a link to the email. `npm run e2e:sample` checks that no sample body text reaches the database.
- Refresh tokens are encrypted at rest. Nothing is sent to any model or third party; the reader is rule-based and local.
- "Delete my data" removes events, corrections and sync state; "Disconnect Gmail" removes the stored token.
- Sample sign-in exists only with `SAMPLE_LOGIN=1` and is always off when `NODE_ENV=production`.

## Known limits (intentionally outside the MVP)
- **Search recall.** Mail is found by a keyword search (subject words and applicant-tracking senders). A recruiter email with none of those words is never fetched. The sample mailbox contains one on purpose. Widening the search would need a decision on privacy and noise.
- **Rules, not a model.** Unusual wording, some vendor emails and some course or promotion mail can be misread. The review queue is the safety net, and it only flags what the reader itself doubts, so a confident mistake can still be wrong. Fix it from the opportunity page.
- **Accuracy is not claimed.** The sample mailbox is written alongside the rules, so it is a regression guard, not a measurement.
- Gmail only. One account per sign-in. No sending email, calendar integration, push notifications, mobile app, sharing, or team features.
- No hosted deployment. It runs locally with local Postgres.
- Programs such as scholarships and courses are not recruiting and are not shown.

## Launch
See the README. In short: `npm install`, set `.env.local`, `npm run db:up && npm run db:migrate`, `npm run dev`. For the sample mailbox add `SAMPLE_LOGIN=1` and use "Try with a sample mailbox" on the landing page.

## Test flows
1. **Sample mailbox:** landing -> "Try with a sample mailbox" -> Today fills in by itself.
2. **Briefing:** the top card, "Coming up", "Waiting" and the pulse make sense for the sample data.
3. **History:** open any opportunity; the steps read in order with correct dates.
4. **Check these:** "Check N" in the nav -> fix one, press "Looks right" on one, hide one; the count drops each time.
5. **Corrections stick:** press Refresh; your fixes are still there.
6. **Close an opportunity** and see it leave the active list.
7. **Delete my data** (account menu) -> Today returns to its empty state.
8. **Real Gmail** (optional, mail before 2026-12-01 only): Continue with Google -> Connect Gmail -> the first read runs by itself.

An automated version of 1-7 runs with `npm run e2e:sample` against a throwaway database.
