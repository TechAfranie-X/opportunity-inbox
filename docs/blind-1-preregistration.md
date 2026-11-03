# blind-1 pre-registration (written before the BLIND mailbox is touched)

Date: 2026-11-03. Everything below is locked. Nothing may be changed after BLIND setup begins; thresholds may not change after BLIND results exist.

## Frozen candidate
| Component | Value |
|---|---|
| Rule extractor | `rules-baseline-2026.11.2-evidence` (EXTRACTOR_VERSION 2026.11.2-evidence), tag on 09877d9 |
| Model reader | `reader-s1-ga5cc64879982` (guide v2 + output spec) |
| Gate | G1-process |
| Reconciliation | `lib/recruiting/reader/reconcile.ts` as of d6b2002 |
| Verification / redaction | `verify.ts`, `redact.ts` as of d6b2002 (body cap 1,400 chars, up to 5 company candidates) |
| Policy | DEFAULT_POLICY, unchanged |
| Code state | git tree of `lib/recruiting` = `f4a966b39b078dd1a950add45f2b11be1486e172`; tree of `lib/opportunities` = `a68b37dca94de3276a1332b823a7ff382ac55c80` (verify with `git rev-parse <commit>:lib/recruiting`) |
| Model access | Haiku-class workers inside the Claude Code session; no new paid API dependency; redacted excerpts only; inputs written to a temporary directory outside the repo and deleted afterwards; the cache stores verified outputs, never inputs |
| Candidate tag | `blind-candidate-1` (this document's commit; code identical to d6b2002) |

## Pass bar (all must hold; reported with Wilson 95% intervals)
1. Recruiting precision >= 80%
2. Recruiting recall >= 80%
3. Recruiting F1 >= 0.85
4. Event-type accuracy >= 80% (reader taxonomy: follow_up and assessment_completed collapsed into status_update; stored labels read through the guide-v2 view)
5. Company normalized accuracy >= 80% (lenient organization match, as in the shadow report)
6. Role accuracy >= 70% (guide v2: program names are not roles)
7. Reader-agreement-region error <= 2%
8. Review / disagreement rate <= 8% (share of all messages in review)
9. Ungrounded structured values surviving verification = 0 (independent re-audit)

Metrics are computed on the reconciled output over all blind-1 messages, using the same definitions as `npm run reader -- report`. Rules-only and model-only numbers are reported alongside for context but do not decide the outcome.

## Procedure
1. Sample uniformly from the BLIND mailbox (same 365-day window, 600 messages if available) with no keyword or prediction input; freeze member ids, thread-context ids, seed, universe hash and manifest hash.
2. Label with the isolated labeler (no predictions, guide v2). Audit the labels if the owner requests it.
3. Only after the owner says labeling and audit are complete: run the rules extractor, the model reader (G1 gate, one run) and reconciliation, once. No prompt, threshold or code change before or after.
4. Report the result against this pass bar, whatever it is.
