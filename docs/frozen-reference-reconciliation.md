# Reconciliation: this branch versus the frozen evaluation reference

Date: 2026-11-18. Reference: git tag `arch-v2-shadow-candidate-2` (the frozen prospective-evaluation candidate; `EXTRACTOR_VERSION = 2026.11.2-evidence`). Compared paths: the freeze guard's `FROZEN_PATHS` (`lib/recruiting`, `lib/opportunities`, `lib/gmail`, `lib/db`, `lib/eval-store`, `drizzle`, `scripts/shadow.ts`, `scripts/loader`).
Read-only analysis: the tag was exported with `git archive` into a scratch directory; nothing in the repository, the tag, the database or any evaluation store was touched.

## 1. What differs
34 files differ (1,896 insertions, 113 deletions). By kind:

| Kind | Files | Effect on what the frozen candidate measures |
|---|---|---|
| **Unchanged** | `lib/opportunities/*`, `lib/db/*`, `lib/eval-store/*`, `drizzle/*`, `scripts/shadow.ts`, `scripts/loader/*`; `lib/recruiting/{predictions,reader/*,entity/*,company,dates,role,signals,policy,history,briefing}.ts`; **`groupEvents`** and `roleRelation` | none |
| **Refactor and additive exports in the rule reader** | `extract.ts` (+91/-?): `outboundEvent` extracted from `extractAll`; `ReadContext`, `isContinuityCandidate`, `contactKeyOf` added; `inheritRoles` exported; one extra signal `contact:<hash>` on employer-sender events | **none on the events produced.** Empirically verified (section 2) |
| **Product retrieval and decoding** | `lib/gmail/body.ts` (charset-aware decoding, HTML entities), `queries.ts`, `recruiting-source.ts`, `source.ts`, `embargo.ts`, `sample*.ts` | **changes the text the reader sees** for non-UTF-8 mail, and which messages are fetched (discovery sweep). The frozen collection used the old decoder and query |
| **Product state and presentation** | `opportunity.ts` (`deriveState` monotonic stage with reopening; `eventNeedsReview` honours doubt and "Looks right"), `actions.ts` (doubt keeps urgency quiet), `corrections.ts` (`confirmed`), `types.ts`, `review.ts`, `presentation.ts`, `format.ts`, `store.ts`, `sync*.ts`, `product-version.ts` | the frozen tag derived stage as "last stage event wins"; the product made it monotonic. Grouping is identical |
| **Tests and fixtures** | 12 test files, `fixtures.ts`, `sample-mailbox.ts` | none |
New product code lives outside the frozen paths: `lib/reliability`, `lib/semantic`, `lib/identity`, `lib/brand`, `lib/discovery`.

## 2. Empirical equivalence of the reader
`extractAll` from the tag and from this branch were run over the 1,000 development-mailbox messages (dev datasets only; BLIND never touched). Compared per message: type, company, role, event date, date kind, time flag, confidence, field confidences, outbound, signals (excluding the added `contact:` hash) and review reasons.
Result: **81 events from each; 0 events differ in any field.** The rule reader on this branch is behaviourally identical to the frozen candidate on the development data.

## 3. Consequences
1. **The audit's grouping defects pre-date the product divergence.** `groupEvents`, `roleRelation` and `roleTokens` are byte-identical to the tag, so cross-cycle merges exist in the frozen reference too. Fixing grouping in the product does not alter the candidate. The pairwise grouping metric in `evaluator.ts` evaluates the frozen reference from the tag checkout, not from this branch.
2. **State derivation is product-only.** The tag's `deriveState` was "last stage event wins". The product's monotonic version is what keeps Ramp and Kleiner in Assessment after expiry.
3. **Corrections to my earlier statements.** Earlier milestone reports said `extract.ts` was unmodified. That is true of its classification behaviour (verified above) but not of the file: it carries 91 lines of refactor and continuity changes since the tag. The frozen candidate is protected by the tag, the pinned `EXTRACTOR_VERSION` and the freeze guard, not by this branch's file contents.
4. **The freeze guard fails on this checkout by design.** `scripts/freeze-guard.mjs` requires byte-identity with the tag in `FROZEN_PATHS` before any evaluation-writing command; evaluation commands must be run from a clean checkout of the tag, never from this branch. The guard's own tests pass (`npm run test:guard`).

## 4. Rules for the lifecycle work
- Keep `EXTRACTOR_VERSION` pinned; any product change that can alter what is shown for an already-read message bumps `PRODUCT_READER_VERSION` (which re-reads Gmail and preserves corrections).
- Do not edit the rule reader's classification (`RULES`, `pickDate` consumers) for lifecycle needs: add facts in the product wrapper (`lib/reliability/assess.ts` `readMail` and a new facts module), so the reader stays equivalent to the candidate. The equivalence check (`benchmarks/lifecycle/tools/frozen-equivalence.mjs`) can be re-run at any time.
- BLIND labels and datasets are never read by the lifecycle benchmark or by anything that guides implementation.
