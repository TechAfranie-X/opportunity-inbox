# Semantic Intelligence Layer v1

Date: 2026-11-18. Product branch (`mvp`) only. Frozen evaluation candidate untouched. **No hosted model is enabled, and none was called.**
Builds on `docs/semantic-reader.md` (whether a second reader helps) and `docs/reliability.md`.

## 1. Why the rules fail on these examples
Reproduced with three synthetic messages shaped like the reports (no real mail):

| Message shape | What the rules did | Why |
|---|---|---|
| `Everpure Recruiting: Your HackerRank ... Invitation`, sent from the assessment platform | Employer "Everpure" at 0.46, no role, no deadline | Correctly kept HackerRank out as the employer, but "Everpure" only exists as a sender-line and subject prefix. Nothing says whether it is the employer or an intermediary |
| "...position at Lyft", sent by an applicant tracking system | Company **unknown** | A company named only in the body is weak evidence (0.3): a name near other words is not a relationship |
| "...your interest in Neuralink", generic sender domain | Company **"Example"** (from the domain) and a corrupted role | The only strong evidence was the sender domain. The word the message is actually about was never tied to the application |

The rules score *where a name appears* (sender, subject, body). The missing concept is the *relationship*: "applied to", "invited by", "assessment for", "on behalf of". That is what a semantic reader reads, and what the rules cannot.

## 2. Architecture
`deterministic reader + semantic reader + evidence verifier + reconciliation`. The pipeline is not replaced.

1. **Deterministic reader** (unchanged): rules, grounding, reliability layer.
2. **Semantic reader** (`lib/semantic/guide-v2.ts`, port `readings?` in `lib/semantic/port.ts`): returns typed entities, an employer with an explicit *basis* and the quoted relationship, a role quote, a deadline quote, an event type, a stage and a certainty. It only proposes.
3. **Evidence verifier** (`lib/semantic/reading.ts`): every quote must be in the message; the employer's relationship quote must contain its name; the employer must not be an ATS, assessment platform, job board, scheduler, agency, recruiter or person; "the sender is the employer" is accepted only when the sending domain is the employer's own; role and date go through the first milestone's verifier. Anything else is an abstention.
4. **Reconciliation** (`lib/semantic/employer.ts`): disagreement is never settled on the model's say-so (rules below).
5. **Engine** (`lib/recruiting/sync-engine.ts`): reader readings feed both consensus (recognition) and employer reconciliation, including the deferred pass. Off, the output is byte-identical.

## 3. Entity model
Entity kinds: `employer`, `recruiting_agency`, `recruiter`, `ats_vendor`, `assessment_vendor`, `job_board`, `scheduler`, `other`.
Employer bases: `applied_to`, `interview_with`, `assessment_for`, `offer_from`, `rejection_from`, `hiring_for`, `represents`, `sender_is_employer`.
Kinds are used to *rule things out* (a sender or named organization never becomes the employer by being present); the basis plus a quote is what *rules the employer in*.

Reconciliation:
- rules found no company, verified employer proposed -> adopted as **likely** (0.5, below the "known" threshold of 0.6), sent for confirmation
- both agree -> kept; with some evidence already it becomes **known**
- rules' company is an organization the reader typed as agency/platform/recruiter -> dropped (replaced by the verified employer as likely, else unknown), flagged
- rules were weak (< 0.5) and the reader differs -> verified employer replaces as likely, flagged; rules were confident -> rules stand, disagreement flagged
- an event the rules never produced takes the reader's verified type (low confidence); a missing role takes the verified role
- the person's correction or "Looks right" always wins (applied later, unchanged)

The UI already distinguishes known / likely / unknown (`entityState`); a reader hypothesis is *likely* (dashed mark, "needs confirmation"), never unknown and never known.

## 4. Before / after (fresh synthetic set, 44 cases, `lib/semantic/entity-set.ts`)
Run: `scripts/semantic-entities.ts export|score`. The reader was an in-session Haiku-class worker following guide v2, blind to the truth labels.

| | deterministic product | + semantic reader (verified, reconciled) |
|---|---|---|
| Recruiting mail shown (36 true) | 26 (72%) | **36 (100%)** |
| Silent misses | 10 | **0** |
| False positives (8 non-recruiting) | 2 | 2 (unchanged) |
| Employer right (30 with a named employer in truth) | 6/22 shown (27%) | **29/30 (97%)** |
| Wrong employer | 3 | 1 |
| Employer invented where a careful person finds none | 3 of 4 | 2 of 6 |
| Role right | 16/18 (89%) | 21/22 (95%) |
| Event type right | 15/26 (58%) | 28/36 (78%) |
| Shown as *likely* (not known) | 9 | 26 |
| Events with a company or reason to confirm | 24 | 34 |

Reader alone (before reconciliation): recruiting call right 44/44, verified employer right 25/30, **wrong 0**, invented where none 0, unsupported yes 0. Wrong-company errors that remain come from the rules' sender-domain guesses ("Example", "Notify"), which the reader cannot demote when it types no entity for them; they are shown as likely.
Development-data (real mailbox) metrics from the previous milestone stand (silent errors 10 -> 4-5, `docs/semantic-reader.md`); this milestone did not re-run them (the scratch evaluation database was removed).

**Honesty:** synthetic cases written by the same team that designed the verifier; one run; the reconciliation rule about agency-typed companies was added once after seeing the first scoring of this set (the reader's output and guide were not tuned). Not an accuracy claim. Review burden rises (24 -> 34 of 36 events carry something to confirm) because every adopted employer is a *hypothesis*; this is the cost of not showing a guess as fact.

## 5. Hosted-model quality and cost (estimates, nothing was called)
Measured only with a Haiku-class worker; stronger models were not run. A hosted model would add what local readers could not (see `docs/semantic-reader.md`): unfamiliar phrasing recognised, employers read from relationships.
Token arithmetic per message (guide 560 tokens shared by a batch of 8, ~450 tokens of redacted input, ~180 tokens of output): about 520 in / 180 out.

| Model (list price, in/out per 1M tokens) | Per message | First sync of 625 messages (sweep) | A typical day (~40 new messages) |
|---|---|---|---|
| Haiku 5.5 ($0.10 / $0.50) | ~$0.00014 | ~$0.09 | ~$0.006 |
| Sonnet 5.5 ($2 / $10) | ~$0.0028 | ~$1.75 | ~$0.11 |
| Opus 5.5 ($4 / $20) | ~$0.0057 | ~$3.55 | ~$0.23 |
Adaptive thinking adds output tokens; use low effort for this extraction task. Results are cached by a hash of the redacted input, so a message is paid for once.
Latency: one batch call of 8 messages is on the order of seconds; the first sync gains tens of seconds, steady state is invisible (run after the rule pass).

## 6. Privacy architecture (disabled)
`lib/semantic/hosted.ts` has **no network code**: the model call is an injected `transport`. Two locks: no code constructs it, and it refuses to run unless `SEMANTIC_HOSTED_APPROVED` is set to a specific phrase.
Sent per message (and nothing else): sender display name and domain, subject, <= 1,400 characters of body with links, addresses, long numbers and the account holder's name removed, received time, up to five employer names from the local resolver; only mail passing the local veto-only triage (commerce, orders, codes, digests never leave). Responses are verified locally; only the verified structured result is cached in memory. No raw body is stored. Requires a no-training, no-retention (or short-retention) arrangement with the provider as a condition.
Enabling would be: a ~10-line `transport` using the official SDK, an API key in the environment (never committed), the approval variable, and a decision on the retention terms.

## 7. What needs your approval
1. **A paid hosted model** (estimates above; Haiku 5.5 is the cheapest candidate).
2. **Redacted message text leaving the machine** (the list in 6). Today nothing does.
3. A retention arrangement for that text.
Neither is activated.

## 8. Remaining failure modes
- Sender-domain guesses by the rules on generic domains are demoted only when the reader names the organization as an agency/platform; otherwise they remain as *likely* ("Example", "Notify").
- Prefix-only evidence ("X Recruiting:" in a subject) is accepted as a hypothesis for an employer, with confirmation; it cannot tell a recruiting team of X from an intermediary named X.
- Deadlines are verified but not yet written to events (dates stay deterministic).
- Review burden rises; likely employers need a click.
- Evidence is synthetic and single-run; no fresh real-mail evaluation and no frozen-candidate evaluation was run (by design).
