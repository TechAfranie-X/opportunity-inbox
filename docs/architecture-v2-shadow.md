# Architecture v2: shadow-mode integration

Date: 2026-11-08. Builds on `docs/architecture-milestone-2.md`. **Architecture v2 is not validated.** The development numbers in that document are optimistic (the earlier system was fitted to that data), and nothing here changes what the product shows. Shadow mode exists to gather evidence, not to claim it.

## Decisions this implements
- Privacy: category-based candidate generation is approved. Raw email bodies stay local. Only minimized, redacted excerpts may reach a model, and only through the explicit worker step below. No weakened protection.
- No paid production model dependency. The model reader still runs only through the existing development worker mechanism (export, worker, import). No external API was added.
- **Recruiting scope is fixed:** employment, internship and contract hiring processes, including the pre-start steps that complete the hire (background screening, eligibility paperwork, offer and onboarding paperwork, start-date confirmation). Courses, scholarships, bootcamps, hackathons, generic programs and other non-employment opportunities are not recruiting. Encoded in the reader guide v3 (`reader/guide3.ts`, version `reader-s1-gb56d5132a955`). Guide v2 and the frozen candidate are untouched (`reader-s1-ga5cc64879982`; a test pins it).
- Development labels predate this scope (they count some program and fellowship applications as recruiting). They are legacy-scope data, not ground truth for v2, and were not used here.

## What runs, and where
```
sync (unchanged)  ─►  old path: keyword query → rules → recruiting_events   (what the user sees)
      │
      └─ READER_V2_SHADOW=1, after the response (next/server after()) ─►  collectShadow()
            1. list v2 candidates: Gmail categories (Primary + Updates), no hiring words
            2. list what the current keyword query would fetch (ids only)
            3. fetch bodies of NEW candidates and keyword-only messages (memory only)
            4. veto-only triage → plan: read / vetoed
            5. frozen rules reading, sampling arm, cohort, legacy-query flag
            6. store routing + rules reading + flags in shadow_reads   (no text)
operator, on demand ─► shadow export  → redacted inputs in a temp dir outside the repo
                       worker reads guide v3 + inputs, writes outputs (existing mechanism)
                       shadow import  → deterministic verification → consensus-and-review → shadow_reads
                       shadow report  → counts only
```
- **Nothing the product reads is touched.** The shadow code writes only `shadow_reads`; a test forbids references to the product's tables. The product UI, routes and sync result are unchanged.
- **It cannot fail or slow a sync.** The hook runs after the response, loads the shadow code lazily (a disabled flag costs nothing), and reduces any error to its type name (no content is logged). It is off by default.
- **Bounded work per run.** At most 150 new messages are fetched per sync (newest first, so repeated runs backfill); candidate listing is capped at 1,500 ids.
- Product sync is currently blocked entirely by `BLIND_SETUP_LOCK=1`. Shadow collection also runs from the CLI (`npm run shadow -- collect`), independent of the lock; that is how it was exercised.

## Data stored (`shadow_reads`, migrations 0004 to 0006, additive)
Routing (`is_candidate`, `legacy_query_match`, `planned_read`, `plan_reason`), the rules' reading (`rules_*`), the verified model reading (`model_*`, evidence as a hash plus an offset, never a quote), the resolution (`state`, `review_reason`, `model_suggests`, field flags, `final_*`), an independent grounding-audit count per model read (`model_ungrounded`), and sampling facts fixed at ingestion (`arrived_at`, `cohort`, `uniform_arm`, `sender_domain`). The cutoff and the sampling rate are frozen code constants, not configuration, and a database CHECK constraint keeps `cohort` consistent with the cutoff. **There is no column for a body, subject, snippet, sender name or quote**; tests check both the schema and the behavior with marker strings. Ingestion fields are write-once (`ON CONFLICT DO NOTHING`), and a model read is first-read-wins (never overwritten), so the system's statement about a message cannot change after the fact.

## Old-vs-v2 instrumentation
`npm run shadow -- report [--user <sub|hash6>]` prints counts only: routing and veto reasons, model coverage, v2 states and review reasons, reader agreement and direction of disagreement, field-flag counts, and the comparison with the current product. The current product is rules-only, so its behavior is fully determined by two stored facts (`legacy_query_match` and the rules' decision). The comparison therefore needs neither the old sync nor anything shown to a user: both recruiting / both not / v2 only / old only / old recruiting now in review / messages the old path fetches that v2 never reads / rows awaiting a model read (not compared). It compares pipelines; it cannot say which is right.

## Review and disagreement, ready for a human workflow
`state = 'review'` with a `review_reason`: `reader_disagreement` (rules and model differ; the model's suggestion is attached), `model_abstained` (low certainty or unverifiable), or `pending_model` (not actionable: waiting on a worker). `reviewItemOf()` / `reviewItems()` return a typed `ReviewItem` (reason, actionable, what each reader said, suggestion, per-field flags). `npm run shadow -- review --user <…>` prints counts by reason. No decision storage exists yet by design; a future workflow adds a separate table keyed by message id (decision, decided_at, decider) and leaves `shadow_reads` immutable. Nothing is shown to the user.

## Candidate programs (not built): `program_opportunity`
Courses, scholarships, fellowships-as-awards, bootcamps and hackathons are valuable to a student, and the fixed scope deliberately keeps them out of recruiting. Design for later, without touching recruiting metrics: a separate question asked of messages the recruiting reader answered "no" to, with its own guide, its own closed set (`course | scholarship | fellowship | hackathon | other`), its own table or columns, its own labels and its own evaluation, never summed into recruiting precision or recall. The shadow table already records every such message's routing, so no re-ingestion is needed. Decision pending: whether and when to build it.

## Runbook
1. `npm run shadow -- collect --user <hash6> [--limit 150]`
2. `npm run shadow -- export --user <hash6> --out <dir outside repo>` (needs `READER_SELF_NAMES`)
3. A worker reads `<dir>/guide.md` and `<dir>/batch-N.jsonl` and writes `<dir>/out-N.jsonl`.
4. `npm run shadow -- import --dir <dir> --delete` (verifies, resolves, stores, deletes the inputs)
5. `npm run shadow -- report` / `review`

## What was exercised, and what was not
- Exercised live on the **development** mailbox: category listing, keyword listing, fetch, triage, rules reading, storage, export, a real worker round trip on 55 messages (all outputs parsed and verified), import, report, review. The numbers from that run (7 recruiting, 3 reader disagreements among 55 reads; 37 of 40 newest unseen candidates were mail the keyword query never fetches) are wiring checks on historical mail, not accuracy evidence.
- Compiled and statically checked, **not exercised in a live request**: the `after()` hook inside the sync action (the product sync is locked, and a live run needs an interactive Google sign-in). It calls the same `collectShadow` the CLI ran.
- Limits: model input is built from the single message (thread length fixed at 1); rules are applied to the single message without thread context; the per-run cap means a large backlog takes several runs.
- Tests, lint, typecheck and the production build are tracked in the commit history; the prospective readiness milestone ends with the full suite passing (see docs/prospective-evaluation-protocol.md section 10).

## Prospective evaluation tooling (added in the readiness milestone)
`dry-run` for `collect`, `status`, `label-set`, `analyze`, `synthetic-run`, `power` and `freeze-check` implement `docs/prospective-evaluation-protocol.md`. The sampling rate is now 25% (weight 4) and the cutoff is 2026-12-01; neither is an environment variable any more, so a stray setting cannot reclassify historical mail. See the protocol for the frozen design and `docs/prospective-power-analysis.md` for the evidence requirement.
