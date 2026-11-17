# A semantic second reader: does it help, and can it ship?

Date: 2026-11-16. Product branch (`mvp`) only. Builds on `docs/reliability.md`. Development data (1,000 messages, 77 recruiting) and synthetic sets only; aggregates only;
`blind-1-amended` was not used; nothing is an accuracy claim. No model is hosted, called or paid for by the product.

## Answer
**A semantic second reader materially helps, and nothing the product can run today without a paid or hosted model is good enough to be it.**
So the architecture is built and tested, default off; no reader ships.

## Diagnosis
After the reliability milestone the remaining silent errors are 10 on development data (5 recruiting messages nobody sees, 5 non-recruiting messages shown as fact) and, on a fresh
synthetic holdout, 3 of 12 recruiting messages still silent. They are unfamiliar phrasing with no hiring vocabulary and no named application: the rules' practical ceiling.

## Alternatives, measured the same way
| Design | Development data | Unfamiliar phrasing (synthetic holdout, never trained on) | Verdict |
|---|---|---|---|
| Reliability layer alone (baseline) | 10 silent errors | 3 of 12 silent | baseline |
| **Model second reader** (verified outputs of an in-session worker; consensus implemented and run through the real engine, privacy triage included) | **10 -> 5** silent errors; counted review items 4 -> 11 per 1,000; true events flagged 20 -> 23 | **12 of 12 recognised, 0 of 12 false "yes"; rescues all 3 silent** | **clearly beats the layer; not shippable without a model** |
| Local statistical reader (hashed words and pairs, logistic regression) | strong inside the mailbox (leave-one-dataset-out AUC 0.976), recovers 3 of 5 silent misses in its top 20 | AUC **0.535** (chance): 0 of 12 recruiting scored likely | rejected |
| On-device sentence embeddings (Apple NaturalLanguage) + logistic regression | AUC 0.941; 1 of 5 in top 20 | AUC **0.451** (below chance) | rejected |
| On-device language model (Apple FoundationModels, macOS 26, free, private) | says "recruiting" on 276 of 784 answered messages: **157 counted review items per 1,000** (vs 4) for 10 -> 8 silent errors | 8 of 12 yes (4 abstained), **5 of 12 false "yes"**, rescued 0 of 3 | rejected: floods review |
| Better use of thread context | none of the 10 remaining silent errors is in a multi-message thread | n/a | not a lever (continuity already links threads) |

Why the local readers fail: with 77 positives they learn the vocabulary the rules already know, which is exactly what is missing in the hard cases. The on-device language model is available and
fully local, but a ~3B model cannot separate hiring mail from look-alikes reliably. The cached model outputs were produced by the earlier shadow work (Haiku-class workers inside the Claude Code
session, guide written after seeing failures, so the development numbers are optimistic); the synthetic holdout was classified by the same mechanism on text written for this purpose, which is the easy case.

## What was built
- `lib/semantic/port.ts`: the second reader as a port. IN: redacted, truncated inputs only, for messages that pass the veto-only triage. OUT: verified outputs only; unverified or low-certainty answers are abstentions.
  The reader **never writes a structured field**: it can only change what a person is asked.
- `lib/semantic/consensus.ts`: disagreement goes to a person, never to a default winner. Rules found nothing and the reader says recruiting -> counted "possibly recruiting". Weak near miss + yes -> counted.
  Strong near miss + no -> folded. Confident rules event + no -> visible doubt, never an urgent action. Agreement, abstention, unverified: no effect.
- `lib/semantic/inputs.ts`: exactly what a reader may see (triage, redaction, 1,400-character cap, the resolver's grounded employer candidates).
- Engine hook (`semantic?` param, default undefined): byte-identical output when off; a reader that throws changes nothing; opinions are kept per run so the deferred continuity pass uses them without a second call.
- Development adapters only (`SEMANTIC_READER=cache|sample`, never in production): the harness cache, and a scripted stand-in for the sample mailbox so the review screen can be exercised.
- Tests pin the contract: no structured value of any event changes whatever the reader says (even a hostile output carrying a company, role and date); abstentions do nothing; inputs never contain addresses, links, numbers or the account holder's name; commerce mail and the user's own messages are never sent.
- Lab: `scripts/semantic-lab.ts`, `semantic-synth.ts`, `semantic-apple.ts`; rejected approaches live under `scripts/semantic/`, not in the product.

## Production viability without a paid dependency
**Not viable today.** The two free, local options were measured and fail (above). A hosted model is a paid dependency and would send redacted text off the machine (a separate privacy decision; none was made).
A larger local model is not installed and cannot be assumed on the target Mac. The port makes the future change a single adapter plus a privacy decision, with verification, consensus, review and tests already in place.

## Remaining failure modes
- The model's dev result is optimistic (guide written after failures; one run; Haiku-class) and its synthetic result is the easy case; there is no fresh real-mail evaluation, so no accuracy claim.
- Even a good second reader adds review burden (about 7 more counted items per 1,000 on development data) and yields at low precision.
- Recruiting mail with no hiring vocabulary stays silent without a model (3 of 12 on the holdout).
