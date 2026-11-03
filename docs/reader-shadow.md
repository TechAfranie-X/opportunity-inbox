# Two-reader shadow milestone (guide v2)

Shadow mode only: nothing here changes product behavior. Frozen rules (`rules-baseline-2026.11.2-evidence`) + a model reader + deterministic verification + reconciliation, measured on the three development datasets. Aggregates only; no email content.

**Code:** `lib/recruiting/reader/` (types, guide v2, redaction, verification, cache, gate, reconcile, taxonomy), `scripts/reader-shadow.ts` (`npm run reader`), tests in `reader.test.ts`.
**Reader version:** `reader-s1-ga5cc64879982` (guide + output spec hash). The guide and prompt were locked before the first scored run and not edited afterwards.
**Model access:** Haiku-class workers inside the Claude Code session; no new paid API dependency. Inputs were redacted and truncated (links, addresses, long numbers, the account holder's name removed; body ≤ 1,400 chars) and written only to a temporary directory outside the repo that was deleted afterwards. The cache keeps verified outputs, never inputs or quote text.

## Guide v2 decisions (locked)
Program or fellowship names are not roles; generic application-opening/closing broadcasts are not recruiting, a reminder tied to the recipient's own started application is; portal/access-code mail counts only with a visible tie to a hiring process; paid gig/contract/project candidacy counts; confirmation + assessment request = assessment; event-style "Application Update" is classified by content; fuller explicit hiring-organization names, no parent-entity inference, vendors are not employers. Taxonomy: `follow_up` and `assessment_completed` collapse into `status_update` + stage in the reader. Stored labels are never edited; they are read through a view (`taxonomy.ts`).

## Results (pooled, 1,000 messages, 77 labeled recruiting; development data)
| | rules | model | reconciled (confident region) |
|---|---|---|---|
| Recruiting P / R / F1 | 86.6 / 92.2 / 0.893 | 82.9 / 88.3 / 0.855 | 94.1 / 95.5 / 0.948 |
| Type | 89.3% | 88.0% | 93.3% |
| Company (lenient) | 81.9% | 83.3% | 90.3% |
| Role (guide v2 view) | 75.3% | 74.0% | 80.8% |

validation-2 (the only set the rules were not fitted to): rules F1 0.750, model 0.708, reconciled 0.903; type 68.2 / 77.3 / 86.4.

- Readers agree on 97.0% of messages; errors when they agree 0.7% (7/970). They disagree or the model abstains on 3.0% (30/1000); 10 of those are labeled recruiting, and review catches 10 of the rules' 17 recruiting errors.
- Type accuracy is 100% (60/60) when the readers' types agree.
- Verification: 329 outputs, 10 structured fields blocked, 0 ungrounded values survive an independent re-audit.
- Run-to-run (two independent runs): recruiting decision differs on 2.7% of gated messages (0.9% of all messages); reconciled state differs on 0.7% of all messages.
- Gate G1-process: coverage 32.9%, recall 77/77. G2-process-unbulk: coverage 17.3%, recall 77/77, 75/77 without the "rules said yes" shortcut; run-to-run 4.6%. Both fitted to development data.
- Cost: about 1.05M subagent tokens for 658 message reads (including worker overhead, about 1.6k tokens per message); about 77-145 s per 55-message batch.

Known weaknesses recorded, not fixed: reconciled role is worse than model-only role on validation-2 (73.9% vs 87.0%) because the rules' role is used when the model has none; reconciled company is confidently wrong on 4/72.
