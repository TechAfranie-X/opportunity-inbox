# Identity v2: stable keys, durable link constraints, schema

Design note for review before Milestone 2. Nothing here is implemented. Evidence: `docs/frozen-reference-reconciliation.md` and `benchmarks/lifecycle/`.

## Principles
1. **Gmail thread identity is evidence, not a merge rule.** Rule 1 ("same thread, same opportunity") disappears as a command. A shared thread adds support to a candidate link; it is overruled by a hard conflict (different specific roles, different cycle, different requisition or program). Benchmark cases G03 and G06 pin this.
2. **An opportunity is `employer + cycle + role identity`.** Cycle is a first-class key (season and year, including "Winter 2027/Summer 2027" as a set), not a stripped token. A role keeps its program ("Externship" vs "Internship") and requisition when present. Years and seasons are no longer discarded by `roleTokens`.
3. **No transitive chaining.** Linking is evaluated against the opportunity's established identity and a bounded time span, never against "the last event's date", so a conversation cannot extend forever (Alcon).
4. **The opportunity's title is a function of its latest applicable evidence**, not the first non-null role.

## Stable keys
Today the key is `company~first-four-role-tokens` with a `~n` suffix by iteration order, recomputed on every read. Any regrouping renames opportunities, which orphans overrides and dismissals (today: 0 and 0 rows on the main account, so the migration is cheap now and expensive later).
Identity v2 key: `employer-key ~ cycle-key ~ role-key` built only from **identity fields**, never from order. When two events could be the same key but are different applications (two roles, same cycle), the role identity disambiguates; a residual collision is resolved by the **earliest member message id**, which never changes once a message is read. Corrections, dismissals and overrides are rewritten once, by event membership (old key -> the new key that contains the same event ids), in a reversible migration step.

## Durable link constraints
Preserving manual corrections and relationships through regrouping needs two things stored, both small:
- **Event corrections** stay as they are (per event, `correction` jsonb, keyed by Gmail message id). They already survive re-sync and regrouping because the event row is the unit.
- **Must-link / cannot-link constraints** from the person ("these two belong together", "split these"), keyed by pairs of Gmail message ids (or by an event and an opportunity-identity key). They are evaluated BEFORE any automatic rule and are never overridden by it. This is what makes a person's split of a merged record durable when the automatic rules change.
**Schema changes:** one additive table `opportunity_links (user, message_id_a, message_id_b, kind in {must, cannot}, created_at, source)` with a unique constraint; optionally a `facts` jsonb column on `recruiting_events` (milestone 4). Nothing is dropped or rewritten in place; the Drizzle migration is additive. Overrides and dismissals gain a `key_version` so old keys can be translated rather than lost.

## What stays derived on read
Grouping and state remain pure functions of the stored events plus constraints, so they are deterministic, testable, and need no re-ingestion. Persisting opportunity assignments (a materialized table) is deliberately NOT proposed: it duplicates truth and makes every rule change a data migration.

## Lifecycle (for Milestone 2, not this note)
Stage (furthest reached) and status (active, expired, cancelled, closed, accepted, non-recruiting) become separate. Terminal evidence (rejection, withdrawal, cancellation, expiry) takes precedence over earlier stages; a low-confidence type cannot advance a stage; an explicit absolute deadline outranks a relative window. Dormancy (60 days) is a follow-up classification only and has the exceptions listed in `benchmarks/lifecycle/README.md`.

## Risks
- Regrouping changes what the person sees: show a one-time "we split N merged records" summary and keep the old key resolvable.
- Thread-as-evidence must not lose real continuity (a reply thread with no role text). The held-out family "plain lifecycle" and dev cases P04/G05 guard it.
- The frozen candidate is unaffected: `groupEvents` identical to the tag is a product change only; the candidate runs from the tag.
