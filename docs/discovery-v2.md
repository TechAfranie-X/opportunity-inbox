# Discovery v2: finding the recruiting mail the product never reads

Date: 2026-11-16. Product branch (`mvp`) only. Aggregate numbers on **development** data; no email content. Nothing here is a
generalization claim (see "What these numbers are not").

## 1. The problem

Every stage after retrieval (extraction, company, grouping, stage, actions, Today) only ever sees what Gmail search returned. A
recruiting email the search does not return is not misread: it is absent, and nothing in the product can reveal that. The
product's search is a first filter on subject words and applicant-tracking senders (`lib/gmail/queries.ts`).

Measured on the development mailbox (3 frozen random samples, 1,000 messages, 77 labelled recruiting, 65 opportunities):

| | keyword search (the product so far) | Discovery v2 (sweep) |
|---|---|---|
| Recruiting messages the search returns | 58 / 77 (75.3%) | 76 / 77 (98.7%) |
| Recruiting messages the product ends up showing (real sync engine) | 54 / 77 (70.1%) | 66 / 77 (85.7%) |
| **Opportunities with no message shown at all** | **17 / 65 (26%)** | **6 / 65 (9%)** |
| False positives | 7 | 9 |
| Precision | 88.5% | 88.0% |
| Messages read (bodies, in memory only) | 105 (10.5% of mailbox) | 625 (62.5%) |

The first row is independent of the reader (it is a property of the search). With 77 positives the 95% interval on a share like
75% is roughly +/- 9 points, and this is one mailbox. The rows that depend on the reader are regression numbers: the reader's
rules were fitted to this data.

## 2. Where the largest failure risk lives (audit)

| Layer | What was measured | Verdict |
|---|---|---|
| **Retrieval** | 19 of 77 recruiting messages never fetched (10 in Updates, 8 in Primary, 1 in Promotions). 17 of 65 opportunities entirely invisible. | **Largest. Silent. Upstream of everything.** |
| Reader recall with everything fetched | 7 of 77 missed (4 "no recruiting language") | Real, second-order; needs a second reader (model) to improve honestly |
| Reader precision | 11 false positives on 1,000 messages | Moderate; the review queue catches about a third of them |
| Company | Of 70 found messages: 58 right, 9 no company (all go to review), 1 wrong and unflagged | Good. Confident-wrong is rare (1.4%) |
| Grouping | 7 of 65 labelled opportunities have 2+ messages; random sampling barely exercises it | Not measurable on this data |
| Review/confidence | Flags only what the reader doubts; cannot flag what it never read or rejected | Bounded by the layers above |

The same gap was found independently by the architecture work (`docs/architecture-decision-recruiting-intelligence.md`, "a quarter
of the positives"); the model-based fix was deferred behind a decision on running a model in production. Discovery v2 needs no
model: the deterministic reader is the precision stage.

## 3. Alternatives tested (all on the same development data)

| Alternative | Result | Decision |
|---|---|---|
| Keep the keyword search | 70.1% of recruiting mail shown, 26% of opportunities invisible | baseline |
| **Widen to Gmail's semantic filter (everything outside Promotions/Social/Forums), keyword hits first** | search recall 98.7%; shown 85.7%; opportunities invisible 9% | **chosen** |
| Read everything (no filter) | 90.9% shown, 100% of mail read | rejected: +1 message for 38% more mail read |
| **Near-miss review tier** (rejected messages that carry hiring vocabulary go to the review queue) | to recover 7 recruiting messages it flagged 337 per 1,000 (330 noise); narrowed to Primary/Updates: 5 recovered for 187 | **rejected**: review burden 40 to 70 times the benefit |
| Provenance-aware review policy (route sweep-only finds to review) | sweep-only precision 83% (15 of 18) vs 88.5%; the sample is too small to justify a rule; the review queue already catches 1 of 3 sweep false positives | not built; provenance is recorded so it can be decided on real data |
| Local or hosted model reader | no local runtime installed; a hosted provider is a new paid dependency | out of scope for this run (constraint) |
| Cross-chunk contact memory (see 6) | would add 3 timeline entries to already-found opportunities; needs a schema change or frozen prediction code | deferred, measured and documented |

## 4. What was built

`DISCOVERY=sweep` (default: unset, which is the old behavior exactly).

- `lib/discovery/strategy.ts`: the mode switch, the sweep query (identical to the frozen shadow work's `CANDIDATE_QUERY_V2`; a test pins
  that), `mergeTiers` (keyword hits first, then sweep-only, de-duplicated), provenance, and retention minimisation.
- `lib/gmail/source.ts`: lists both tiers when the flag is on. `lib/gmail/sample-source.ts`: same for the synthetic mailbox (with a
  stand-in for Gmail's Promotions classifier).
- `lib/recruiting/sync-engine.ts`: tags events and predictions with the tier that found them. Nothing else about the engine changed.
- `lib/discovery/legacy-query.ts`: a local model of the old search, derived from the query string, for measurement.
- `scripts/discovery-lab.ts`: the experiments above (aggregate output only). `scripts/e2e-sample.ts`: now runs in both modes.

Design rules, each pinned by a test:

1. **The product never gets slower to its first useful result.** Keyword hits are read first; the sweep follows under the same
   time budget and resumes on the next request (it is incremental: a message read once is not read again).
2. **The reader is unchanged.** No rule was edited and nothing was fitted to a development failure.
3. **No new retention beyond the flag's purpose.** A message the sweep read and the reader rejected is remembered by id alone: its
   sender domain is not stored (`event_predictions.sender_domain = ''`). Bodies are never stored, as before. The end-to-end test
   plants a bank statement and a friend's message and asserts that none of their text or domains reach the database.
4. **Provenance for later comparison.** Events and predictions carry `via:keyword` or `via:sweep` as a signal (no schema change).
   With the flag off, nothing is written and the output is byte-identical to before.
5. **Frozen code untouched.** `lib/recruiting/extract.ts`, `predictions.ts`, `reader/*`, `shadow/*`, `lib/db`, `drizzle` and the
   evaluation tag are unmodified. The evaluation embargo still applies to both tiers (`applyEmbargo`).

## 5. Privacy and cost

- Gmail scope is unchanged (read-only). The sweep reads more bodies **in memory during a sync**, exactly as the keyword path does;
  the database holds only extracted fields for accepted events plus, for everything read, a message id and the reason.
- About 60% of the mailbox is read instead of 10%. The first sync therefore takes longer (the existing auto-continue runs up to 8
  consecutive 150-second passes; "Refresh" continues after that). Gmail quota use is higher but free.
- No new service, key, model or dependency.

## 6. Remaining weaknesses (recorded, not fixed)

- **Reader recall:** with everything fetched the rules still miss 7 of 77 and add 11 false positives. Closing this honestly needs an
  independent second reader (the model path in `docs/architecture-milestone-2.md`).
- **Chunk dependence:** the reader links a keyword-free message to an earlier one from the same employer contact only inside one
  batch. With chunks of 20 threads, 4 of 79 events (3 true) found with one batch are lost. They attach to opportunities that were
  already found, so this affects timeline completeness, not discovery. A fix needs to persist a hashed contact key (a schema change
  or an edit to frozen prediction code), so it was deferred.
- **Existing installs:** switching the flag on does not re-read mail already evaluated as "not recruiting" by the keyword path, only
  mail the keyword path never listed.
- **Window:** the sweep lists up to 4,000 messages per sync inside the existing 365-day window.
- **Promotions:** recruiting mail Gmail files under Promotions stays invisible (1 of 77 here).

## 7. What these numbers are not

- Not accuracy claims. The reader was fitted to these three datasets; `blind-1-amended` was not used (not here, not as evidence).
- Not a fresh evaluation. One mailbox, 77 positives.
- The datasets are frozen (manifest hashes `54125b11...`, `6400d544...`, `b03fdc38...`), so the numbers can be re-derived.

## 8. Reproduce

```bash
# 1. development labels only (no content): latest label per message for the three development datasets, exported from the
#    evaluation database copy to a JSON file outside the repo
#    select json_agg(r) from (select distinct on (d.name, l.gmail_message_id, l.field)
#      d.name as ds, l.gmail_message_id as id, l.field, l.value from labels l join eval_datasets d on d.id = l.dataset_id
#      where d.name in ('dev-random-1','validation-1','validation-2')
#        and l.field in ('is_recruiting','type','company','role','stage','opportunity_ref')
#      order by d.name, l.gmail_message_id, l.field, l.created_at desc) r;
# 2. the experiments
node --no-warnings --import ./scripts/loader/register.mjs scripts/discovery-lab.ts <labels.json>
# 3. the product, both modes, against a scratch database
DB_CONTAINER=<postgres container> npm run e2e:sample
DB_CONTAINER=<postgres container> DISCOVERY=sweep npm run e2e:sample
```

## 9. Turning it on

Add `DISCOVERY=sweep` to `.env.local` and restart. Remove it to return to the keyword search; nothing stored needs to change
(events found by the sweep stay and are labelled `via:sweep`). The evaluation embargo (mail from 2026-12-01 is never read) and
`BLIND_SETUP_LOCK` apply to both tiers exactly as before.
