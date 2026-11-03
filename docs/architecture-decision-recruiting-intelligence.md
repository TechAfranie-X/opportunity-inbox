# Architecture decision: recruiting intelligence

Status: proposed, 2026-11-03. Aggregate numbers only; no email content. Evidence is from dev-random-1, validation-1 and validation-2, all of which are now **development data**. Nothing here is proof of generalization.

## 1. What is actually going wrong

1. **Fresh-set numbers mix extractor weakness with dataset difficulty.** validation-2 has fewer positives (5.8% vs 8.3% and 10.5%), more borderline items and a different role-labeling pattern. A zero-shot model that was never fitted to validation-1 drops from F1 0.899 (validation-1) to 0.706 (validation-2), the same ~0.19 drop the fitted rules show (0.941 → 0.750). So "the rules collapsed" overstates it; recruiting detection on validation-2 is about equally hard for both.
2. **Event type is where wording-sensitivity really shows.** Rules: 95% / 97% on the sets they were fitted to, 59% fresh. Model: 85% / 88% / 77%, a flatter profile. The model's remaining type errors are adjacent-class confusions (follow_up/status_update, interview_invite/scheduled), i.e. taxonomy, not comprehension.
3. **Role is a label-policy problem first.** The share of recruiting messages labeled "no role" is 19% (dev-random-1), 18% (validation-1) and 70% (validation-2). Program or fellowship names were labeled as roles 8 times in the two earlier sets and 0 times in validation-2. Role accuracy cannot be compared across datasets until the definition is fixed.
4. **Company varies because of abstention and short forms**, not wrong employers (confident-wrong is low). A model resolves "Ti" or an acronym from a display name; the deterministic resolver is the better judge of whether the chosen name is supported by the message.
5. **Thread context matters less than assumed for classification.** 11 of 77 positives (14%) are in multi-message threads; 1 of 23 in validation-2. It matters for grouping and for inheriting company or role into short replies.
6. **The evaluation design understates opportunities.** In validation-2, 23 recruiting messages belong to 23 distinct opportunities. Random message sampling almost never yields multi-message opportunities, so grouping is barely measurable.

## 2. Worth keeping

Company resolver (as candidate generator and validator), thread and contact state, date parsing, grouping, policy and abstention layer, evaluator, label store and audit tooling, append-only evidence log, user corrections as overrides. The current rule extractor (frozen as tag `rules-baseline-2026.11.2-evidence`) is kept, **demoted** to a second reader.

## 3. Candidate architectures

| | A. Redesigned rules | B. Model-first reader | C. Two independent readers + verification | D. Thread/opportunity-level model | E. Local trained classifier |
|---|---|---|---|---|---|
| Generalization | Low ceiling; each fresh set shows new phrasings | Better type stability; detection not better | Best: errors are partly independent | Same as B plus context | Too little data (77 positives) |
| Complexity / time | Low, never finished | Medium, weeks | Medium, weeks (B plus reconcile) | High | Medium, data-starved |
| Cost / latency | Free / instant | Cents per 100 messages / 1-2 s each, async | Same as B | 3-5x B | Free / instant |
| Privacy | Best (local) | Redacted text leaves the machine | Same as B | More text leaves | Best |
| Hallucination | None | Controlled by quote and candidate validation | Same | Higher | None |
| Abstention | Hand-built confidences that did not transfer | Categorical certainty | Disagreement is the abstention signal | Same as B | Calibratable |
| Corrections | Hand-written rules | Few-shot or guide edits | Same | Same | Retrain |
| Product fit | Weak on new wording | Good | Good | Over-engineered for 14% thread positives | Weak |

Not worth pursuing now: A (more patching), D (until C works), E (not enough labels).

## 4. Experiments

**Experiment 1: lexical gate.** A loose vocabulary or ATS-sender gate keeps 100% of positives (77 of 77) but passes 40-48% of messages. (My earlier estimate of 10-15% was wrong.)

**Experiment 2: zero-shot model reader.** Six Haiku-class workers read the 443 gated messages from the three sets. Input: redacted text (links, addresses, long numbers and the candidate's name removed; body truncated to 1,400 characters). No labels and no extractor output were visible. The definitions-only guide was written by me after seeing failures, which is a contamination risk. Message-level only, one run, no thread context. Gated-out messages count as "not recruiting".

| | dev-random-1 | validation-1 | validation-2 |
|---|---|---|---|
| Recruiting F1, rules / model | 0.977 / 0.923 | 0.941 / 0.899 | 0.750 / 0.706 |
| Type, rules / model | 95 / 85 | 97 / 88 | 59 / 77 |
| Company (lenient), rules / model | 90 / 85 | 87 / 93 | 68 / 73 |
| Role (lenient), rules / model | 86 / 52 | 93 / 62 | 52 / 70 |
| Ungrounded company or role values | 0 | 0 | 0 |

- **Grounding:** across 443 outputs, no company or role value fell outside the message text, and 1 of 443 evidence quotes did not match. Quote-based grounding is cheap and works.
- **Role:** the model's low dev-set role scores are almost all "label has a role, model said none" (15 of 17), because my guide nulls program names. This is label policy, not capability.
- **Certainty:** the model's high-certainty recruiting decisions were right 377 of 389 times (97%); medium 38 of 48 (79%); low 3 of 6.
- **Agreement:** the rules and the model disagree on recruiting for 26 of 1,000 messages (4, 3 and 19 per set). Where they agree, both are wrong on 8 of 974 messages (0.8%), mostly probable label ambiguities. On validation-2, disagreement would have flagged 8 of the rules' 12 recruiting errors at a 4.75% review rate. This is the strongest result.

Limits: 77 positives in total; one run (no determinism check); Haiku-class only; the lenient normalization favors both sides equally.

## 5. Recommendation

**Two independent readers with deterministic verification and disagreement-driven review (C).**

1. **Gate** (deterministic): vocabulary or ATS-sender prefilter.
2. **Reader 1:** the frozen rule extractor. **Reader 2:** a model reader with structured output.
3. **Model input:** the guide as instructions, plus redacted sender, subject and body excerpt, plus the resolver's company candidates and the thread's known company and role when present.
4. **Model output:** recruiting yes or no, stage, type, company as a **candidate id or none**, role and date as **exact quotes**, an evidence quote and categorical certainty.
5. **Verifier:** every quote must be a substring of the message; the company must come from the candidate list; the role passes the existing plausibility checks; dates are parsed from the quote by code. Failure drops the model field.
6. **Reconcile:** agreement gives a confident result. Disagreement or low certainty gives a review item (never silently hidden). User corrections override.
7. **Opportunity layer** stays deterministic (grouping, Today buckets, policy).

**Representation changes to evaluate:** collapse the type distinctions the product does not act on (follow_up vs status_update, assessment_completed), and treat role as optional display text rather than a grouping key, until the role policy is settled.

## 6. Why this over the alternatives

- The model is not clearly better at detection, so replacing the rules (B) buys little and gives up a working second opinion.
- Independent error profiles make disagreement a cheap, honest abstention signal, which is what trust in this product needs.
- Rules alone (A) fail on type for new wording, and each fix is a fitted patch.
- Thread-level (D) and trained classifiers (E) are not justified by the data.

## 7. Remove or replace

Stop extending `extract.ts` rules and role inheritance. Demote role accuracy from a headline metric. Replace the type decision as the primary reader with the model reader, with rules as the second reader. Keep everything listed in section 2.

## 8. Effort

About 1.5-2 weeks: guide v2 and label-policy decisions (days), model reader with schema, verifiers and cache (about 4 days), reconcile and shadow evaluation (about 3 days).

## 9. Cost, latency, privacy

- **Cost:** about 1.3-1.5k total tokens per message in the experiment. A full 4,662-message backfill is roughly 2,000 gated messages, so on the order of a few dollars at small-model pricing (verify against the current price list); incremental sync costs cents per day.
- **Latency:** ~1-2 s per message in batches; async, never on the request path. Today shows rules output with a pending marker.
- **Privacy:** redacted excerpts leave the machine. Requires explicit opt-in and a no-retention API. Inputs are not stored; only outputs plus offsets and quote hashes are persisted. The model interface stays swappable for a local model.
- **Disclosure:** the experiment itself sent redacted development-mailbox text to Haiku-class workers in this Claude Code session. Scratch files are deleted.

## 10. Smallest next milestone

Shadow-mode dual reader on the development sets only, no UI change:

1. User settles the label-policy points (program names as roles, generic deadline reminders, portal codes, gig-work invites, confirmation plus assessment, event-style updates, company name granularity). Guide v2 is written before any model output is seen.
2. Model reader with schema, verifiers and cache; the prompt may not be edited after the first scored run.
3. Run twice to measure determinism; report agreement-region error, review rate, grounding and cost.

## 11. Abandonment criteria (fixed in advance)

Abandon (keep rules-only plus user corrections, accept the ceiling) if any of:

- agreement-region error is above 1.5% or the disagreement rate is above 8% on pooled development data;
- ungrounded values are above 0 after verification, or two runs differ on more than 5% of recruiting decisions;
- type accuracy is below 85% pooled (adjacent-class confusions excluded only if the merged taxonomy is adopted first);
- the cost per 1,000 gated messages or the p95 latency exceeds a limit the user sets;
- the user declines to send redacted text to an external API.

The one-shot BLIND check follows only if all criteria hold, and its result is final. No validation-3.
