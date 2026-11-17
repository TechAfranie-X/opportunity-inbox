# Reliability: making silent failures visible

Date: 2026-11-16. Product branch (`mvp`) only. Builds on `docs/discovery-v2.md`. Numbers are **development regression numbers** (the rule
reader was fitted to those datasets) or **synthetic stress results**; none is an accuracy claim, and `blind-1-amended` was not used.

## Principle
A wrong answer the person can see is a small problem. A wrong answer nobody can see is the real one. Every change here either makes a failure
visible and recoverable, or removes a way it could happen silently. No rule was fitted to a dataset's individual failures.

## 1. The silent-failure paths found

| # | Where | What used to happen silently |
|---|---|---|
| 1 | Retrieval | Recruiting mail the keyword search never lists (about a quarter; fixed in `discovery-v2`). Mail beyond the listing cap was never read and nothing said so. |
| 2 | Fetching | A message that failed to download was dropped and counted as handled; the sync reported "complete". |
| 3 | Replies | A failed reply check was read as "no reply", leaving a stale "reply to the recruiter" reminder that looked certain. |
| 4 | Body decoding | Non-UTF-8 mail (windows-1252, ISO-8859-1) turned apostrophes and accents into garbage that broke patterns; numeric HTML entities (`&#8217;`) were never decoded; a "view this in your browser" plain-text stub hid the real HTML message; text behind an attachment id read as an empty (so "not recruiting") message. |
| 5 | Chunking | A keyword-free message was linked to an earlier one from the same employer contact only inside one batch, and the sync reads newest first, so a reply was judged before its anchor existed. The events shown depended on how the sync happened to be cut (4 of 79 on development data). |
| 6 | Prediction log | A message linked through stored context would have been logged as "not recruiting" while the product showed it. |
| 7 | Revisiting | The product's "already read" memory was keyed to the frozen evaluation candidate's version, which product work must not move, so an improved reader could never re-judge old mail. |
| 8 | Reader recall | Recruiting mail in unfamiliar phrasing is rejected with no trace. On a fresh synthetic holdout the rule reader alone found 3 of 12. |
| 9 | Reader precision | The reader's false positives are as confident as its true positives (type confidence does not separate them), so 7 of 10 were shown as fact. |
| 10 | Type | A rejection in unfamiliar wording was shown as a plain "follow up" or "assessment": the opportunity stays alive. |
| 11 | Evidence | Nothing checked that a displayed company or role could be traced to the message. |
| 12 | Stage | Any later "thank you for applying" receipt or recruiter nudge overwrote a more advanced stage, dragging an interview back to "applied". |

## 2. What was fixed

- **Sync reports what it could not do** (`sync-engine.ts`, `sync-notice.ts`): unreadable messages (kept unevaluated so the next sync retries them), unchecked reply threads and a capped
  listing are counted and shown in a notice under the navigation until dismissed or resolved. Deleted messages are told apart from failed ones.
- **Body decoding** (`lib/gmail/body.ts`): declared charsets, all numeric and common named entities, stub-versus-HTML selection, and an "unreadable" flag for text behind an attachment id.
- **Continuity survives chunk and sync boundaries**: a stored, hashed contact key (a pseudonym; the address is never stored) lets a later chunk or sync link a keyword-free message to its
  earlier candidacy mail, and a bounded in-memory deferred pass at the end of each run handles the newest-first ordering. Chunk size no longer changes the result.
- **The prediction log agrees with the events** row for row (`reconcilePredictions`).
- **Revisiting** (`product-version.ts`): the product has its own reader version. Changing it makes the next sync re-read every message, keep corrections and confirmations, and re-derive the
  rest. (History is append-only: each version adds rows.) The frozen candidate's version is untouched and still pinned by its test.
- **A reliability layer around the unchanged rule reader** (`lib/reliability/`):
  - *Grounding*: a company or role that cannot be traced to the message (or the message it was linked to) is dropped to unknown and sent to review. 0 violations on development data.
  - *Membership doubt*: nothing names one of the reader's applications and Gmail did not mark it important, or the text reads like a course, event or promotion with no job in it. Visible in review, and never an urgent action.
  - *Conflict*: a farewell about the reader's search or future on something typed as an ongoing update ("best of luck with your search") is flagged instead of shown as a follow up.
  - *Near misses*: a message the reader rejected, or could not read, that still looks like hiring mail goes to the review list as "possibly recruiting" and **not** into the pipeline until a person says so.
    Strong ones (important, names a candidacy, not bulk, or unreadable) are counted in the badge; weak ones (about a job or onboarding from a person or hiring mailbox at an employer, or from an applicant platform) wait in a folded list and are never counted.
    Hiding one forgets its subject and sender.
- **Stage only moves forward**, except an ending (rejection, withdrawal), and a later non-ending event reopens a reversed rejection.

## 3. Evidence

### Development data (1,000 messages, 77 recruiting, 65 opportunities), real engine, sweep, chunks of 20
| | rule reader only | with the reliability layer |
|---|---|---|
| Recruiting messages in the pipeline | 69 / 77 (89.6%) | 69 / 77 (89.6%) |
| (the same, before the continuity fix) | 66 / 77 (85.7%) | |
| Misses nobody sees | 8 | 5 |
| Misses surfaced for a look | 0 | 3 |
| False positives shown as fact | 7 | 5 |
| False positives visible in review | 3 | 5 |
| **Silent errors (misses + false positives shown as fact)** | **15** | **10** |
| Review cost | 18 true events flagged | 20 true events flagged, plus 19 near-miss items (about 6 per 1,000 messages counted, 13 folded) |
| Events that differ from a one-batch read, by chunk size 1 to 100 | up to 4 | **0** |
| Company or role not traceable to the message | not checked | 0 of 69, 0 of 52 |
| Wrong type shown as fact | 2 | 1 |

### Synthetic holdout (12 recruiting and 12 non-recruiting messages, written after the layer was frozen, run once, never tuned against)
| | rule reader alone | with the layer |
|---|---|---|
| Recruiting found | 3 / 12 | 3 / 12 |
| Recruiting surfaced for a look (2 counted, 4 folded) | 0 | 6 |
| **Recruiting still silent** | **9 / 12** | **3 / 12** |
| Non-recruiting shown as fact | | 0 / 12 (3 doubted) |

The three that stay silent are **known gaps, pinned in `assess.test.ts` rather than hidden**: a skills-test invite from an assessment platform, a reference request, and a virtual-onsite agenda.
They contain no hiring vocabulary, name no application, and none is bulk mail from a recognised platform with an employment word.

### Honesty about the first synthetic set
`STRESS` (15 + 15 messages) was used while developing the layer: after seeing which cases failed, criteria were refined, so its clean result (no recruiting message silent, no non-recruiting
message shown as fact) is a **development** result. That is why `HOLDOUT` exists and is the only stress number to rely on.

## 4. What happens now when the system is uncertain
- A detail it doubts: shown, flagged in **Check**.
- Whether it is hiring mail at all: shown quietly (no "needs you" alarm), flagged in **Check**.
- A goodbye it read as an update: shown, flagged in **Check** ("Did they say no?").
- Mail it did not recognise but that looks like hiring: not in the pipeline; in **Check** (badge) or in the folded "Also possibly recruiting" list. "Yes, it is recruiting" adds it; "Not recruiting, hide it" removes it and forgets it.
- A read that could not finish: a notice under the navigation says how many emails, replies or how much old mail was not covered; Refresh retries.
- A value it cannot trace: dropped to unknown and sent to review.

## 5. Deliberately not fixed
- **Recruiting mail with no hiring vocabulary and no named application** (3 of 12 holdout). Closing this without a model would mean matching on features that also describe a great deal of ordinary mail. A second, independent reader is the right fix and needs a model decision.
- **Promotions-only recruiting mail** (1 of 77): a learned-domain tier would help only after a sender is already known.
- **Continuity when a backfill spans several requests**: the deferred pass is per request; an anchor that arrives in a later request does not re-judge replies already judged. New mail afterwards links correctly.
- **Text behind an attachment id** is reported, not fetched.
- **Time zones, grouping on real multi-message opportunities and role inference** were not audited or measured: the development data has only 7 opportunities with two or more messages.
- **Switching `DISCOVERY` does not re-read** mail the keyword path already judged. Changing the reader does (via `PRODUCT_READER_VERSION`), and this milestone changed it, so the first sync after upgrading re-reads everything.

## 6. Privacy
- Bodies remain in memory only. The new retained facts: a **pseudonymous contact key** (a truncated hash; the address is never stored), and for **near misses** the subject, sender name and domain, the same fields events already keep.
  A near miss a person hides keeps none of them (`ignoreEvent`, asserted end to end).
- Gmail labels (INBOX, IMPORTANT, CATEGORY_*) are read transiently as evidence; they are not stored.
- No new service, key, model or dependency. Frozen evaluation code (`extract` rules, `predictions.ts`, `reader/*`, `shadow/*`, `lib/db`, `drizzle`) and the evaluation tag are unmodified in behaviour;
  the frozen version constant is unchanged.

## 7. Reproduce
```bash
# labels: see docs/discovery-v2.md section 8 (development datasets only)
node --no-warnings --import ./scripts/loader/register.mjs scripts/reliability-lab.ts <labels.json>
npm test                                  # includes the pinned holdout outcomes
DB_CONTAINER=<postgres> DISCOVERY=sweep npm run e2e:sample
```
