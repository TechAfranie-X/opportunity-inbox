# blind-1-amended: protocol amendment (written before sampling)

Date: 2026-11-08. Amends `docs/blind-1-preregistration.md`. This evaluation is called **blind-1-amended**. It is a held-out evaluation with a disclosed contamination event, not a pristine BLIND evaluation, and every report of its results must say so.

## What happened
- The candidate (rules extractor `2026.11.2-evidence`, model reader `reader-s1-ga5cc64879982`, gate G1-process, reconciliation, verification/redaction, DEFAULT_POLICY) was frozen and pre-registered on 2026-11-03, before this mailbox was connected.
- On 2026-11-08 the mailbox was connected. The product's `/today` page auto-started its first sync (`neverSynced` -> `autoSync`), which was not intended for an evaluation mailbox. It completed at 00:12:40 UTC.
- The frozen **rules** ran over **133 message IDs / 126 threads** (130 inbound messages matched by the product's recruiting-keyword query, plus 3 of the user's own sent messages in those threads). 133 rule predictions and 75 recruiting events were written.
- The **model reader did not run** (it is not in the sync path; no reader cache or output exists).
- **No labels, datasets or evaluation runs existed** for this mailbox at that time.
- **Some rule outputs were briefly visible in the product UI** (the page rendered 75 extracted events after the sync).
- No opportunity overrides, dismissals or user corrections were made.
- Containment: the dev server was stopped; `BLIND_SETUP_LOCK=1` now blocks all product sync (`app/sync-lock.ts`). It stays on.

## Decision
The 133 processed messages and their threads are **not excluded** from sampling. The sync was recruiting-keyword-biased, so excluding it would remove most of the mailbox's recruiting positives and change the population. The pre-registered estimand is preserved:

> a uniform random sample of up to 600 messages from the full 365-day mailbox universe, with no keyword or prediction input.

Universe query (same as every other dataset): `newer_than:365d -in:spam -in:trash -in:drafts -in:sent`. No `--exclude`.

## Sampling (declared before running)
- Dataset name: `blind-1-amended`, kind `blind` (the only kind with the one-official-run protection), account tag `blind-1-amended`.
- n = 600 (fewer only if the universe is smaller). Seed: `blind-1-amended:2026-11-08`.
- Frozen at creation: member ids, thread-context ids, seed, universe hash, manifest hash. Unfetchable messages stay in the set and are never replaced.
- The overlap between sampled messages and the 133 processed messages is reported as a count only. No predictions are shown.

## Sampling outcome (recorded after sampling, before any labeling)
- 600 members sampled from a universe of 3,587 messages (universe hash `238001340494875a8fd6baaa0a5a5ef6ed4c78d1ce33236fb3d265bdd8f18a08`), 590 threads, 80 thread-context messages in 55 threads, 0 unfetchable. Manifest hash `a2e3e34d623c73f271bf96871b3b181f2989ee416e2329524602ee301ba80143`, frozen 2026-11-08T01:26:39Z, `verifyFrozen` ok, database and local manifest agree.
- Overlap with the 133 accidentally processed messages: **15 of 600 messages (15 threads)**. Uniform sampling would give about 22 on average (133 x 600 / 3587), so there is no sign of selection toward the processed set.
- Known gap: 6 Gmail rate-limit failures (403 rateLimitExceeded) hit thread-context fetches, which fail silently to "no context". All members fetched, so no member is missing, but up to 6 of the 590 threads may have less thread context than production would give. Context is not part of the manifest hash. The same snapshot feeds the labeler and, later, the extractor and reader, so labels and predictions see identical input. The gap is disclosed, not repaired, to avoid changing a frozen snapshot.
- Tooling change made before labeling (no effect on the candidate): the labeler no longer imports `lib/recruiting/evaluator.ts`, which pulled the extractor into its import graph. It uses a copy of the pure `resolveLabels` in `lib/eval-store/resolve-labels.ts`; a test fails if the copy and the original diverge, and another checks that nothing prediction-, extractor-, reader- or Gmail-related is reachable from the labeler. `lib/recruiting` and `lib/opportunities` are unchanged.

## Rules that do not change
- No architecture, prompt, rule, threshold, gate, reconciliation or label-policy change may be made on the basis of the accidental rule outputs or of anything learned from this dataset. The pass bar in the pre-registration is unchanged.
- Ground-truth labels are created only in the isolated hidden-prediction labeler (`npm run eval:label`), which reads only the local snapshot and the `labels` table for the dataset. It does not read `event_predictions` or `recruiting_events`, and it does not show model output.
- Labels are not made from the Opportunity Inbox UI.
- Model reader and evaluator are run only after the owner says labeling (and any requested audit) is complete, once, as in the pre-registration.

## Reporting
- Headline numbers are the pre-registered metrics on all blind-1-amended messages, labeled "amended (disclosed rule-output exposure)", never "BLIND".
- Declared secondary analysis, fixed now: the same metrics with the messages that overlap the 133 processed messages removed, to show whether the exposure changed the result. It informs interpretation only; it does not decide pass or fail.
