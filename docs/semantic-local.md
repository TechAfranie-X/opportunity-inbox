# Local semantic reader (M30 semantic mission)

Date: 2026-11-18. Branch `mvp`. All numbers are on SYNTHETIC fixtures written by independent authors who never saw the code (kept outside the repo). They are
not accuracy claims about real mailboxes. Nothing here is model training: a pretrained model is used as-is, locally.

## What it is
A second reader based on a pretrained language model that runs **on this machine**. It interprets language; deterministic code enforces integrity.

```
Gmail (read-only) -> rule reader + reliability layer + ingestion facts          (unchanged, deterministic)
                  -> injection guard -> veto-only triage -> redaction (<=1,400 chars)
                  -> LOCAL MODEL (guide v3, JSON out)                           lib/semantic/guide-v3.ts, local.ts, hosted.ts (createModelReader)
                  -> evidence verification: every quote must be found in the message; employer must be grounded     lib/semantic/reading.ts
                  -> assist consensus: create / exclude / route                 lib/semantic/assist.ts
                  -> refinement gates (non-employment, newsletters, practice, marketing, unrelated)   lib/lifecycle/refine.ts
                  -> identity/lifecycle matching -> actions, briefing, review
```

- **Authority of the model** (assist mode, `SEMANTIC_READER=local`): rules found nothing + model high certainty yes -> a pipeline event typed by the model
  (flagged `semantic:event`, shown, refinement gates still apply); medium certainty -> a counted question for a person; a stored "possibly recruiting" item the
  model reads as not recruiting -> excluded from review (kept as metadata, `semantic:excluded`); a generic `status_update` the model can type precisely -> typed.
  Dates, employer, role come from deterministic code or from the verified reading; a model role is adopted only if it reads like a job title.
- **Rule vs. model on interview stage**: "invitation" vs "scheduled" is decided from text facts (confirmation phrase + explicit time), not by the model.
- **User corrections survive**: `saveExtractedEvents` never touches `correction`; confirmed/corrected events are never excluded; "Looks right" on an excluded
  item puts it in the pipeline.
- **Model unavailable**: opinions fail closed ("no opinion"), and in assist mode the batch is NOT remembered as evaluated, so the next sync offers it to the model again.
- **Reassessing stored mail**: `scripts/reassess-possible.ts <sub>` re-fetches stored near-miss messages (Gmail read-only), reads them in memory with the local model,
  and updates the stored metadata. Nothing else is stored.

## Privacy
- Loopback only: `localTransport` refuses any non-loopback host (unit-tested). The model server is `mlx_lm server` bound to 127.0.0.1.
- Redaction, truncation, veto-only triage and the "never store bodies/prompts" rule are unchanged. Prompts are not persisted.
- Email text is treated as untrusted: guide says so; an **injection guard** (`lib/semantic/inject.ts`) keeps any message that addresses the AI from reaching it;
  verification requires evidence quotes to exist in the message. A first run of a sealed fixture showed the 4B model obeying an injected "record this as an accepted
  offer"; that is why the guard exists.
- No fine-tuning, no training on private mail. No hosted provider is called.

## Models evaluated (local, MLX 4-bit, Apple M5 / 16 GB)
| Model | License | Disk | Notes |
|---|---|---|---|
| Qwen3-4B-Instruct-2507-4bit | Apache-2.0 | 2.3 GB | **chosen default**: about 3 s per message with a compact guide |
| Qwen3-8B-4bit | Apache-2.0 | 4.6 GB | development fixture A, model alone: precision 94.4% / recall 98.5%, **identical to 4B**, 1.8x slower (5.4 vs 3.0 s per message). Not adopted; weights deleted to free disk. |
| Apple FoundationModels (on-device) | OS | 0 | measured earlier (docs/semantic-reader.md): too many false yeses |

## Results (synthetic sealed fixtures, first run of each, no tuning on that fixture)
Rules-only vs hybrid (rules + local 4B model, assist mode). "Recall" = genuine candidacy messages that reach the pipeline.

| Fixture | Messages | Rules precision / recall / stage type | Hybrid precision / recall / stage type | Hybrid grouping P / R |
|---|---|---|---|---|
| D (multilingual, bland subjects) | 148 | 89.3% / 28.7% / 64.0% | 89.1% / 94.3% / 80.5% | 96.9% / 54.4% (before linking fixes) |
| E (noisy wide-search inbox) | 169 | 91.7% / 45.2% / 66.7% | 90.8% / 94.5% / 71.0% | 100% / 70.9% |
| **F (release gate, never inspected before this run)** | 168 | 100% / 33.6% / 48.7% | 95.5% / 91.4% / 72.6% | 94.8% / 88.4% |
| **G (release gate, never inspected before this run)** | 159 | 91.2% / 50.8% / 67.7% | 88.1% / 96.7% / 84.7% | 100% / 87.6% |

Review burden on F/G with the model: 1 "possibly recruiting" item each (versus 41 on the real second account before this work). Latency about 3 s per message
(sync is incremental; the first sync of a large mailbox takes proportionally longer).

## Failure patterns seen (and what was done)
- Non-employment "applications" (visa, loan, lease, club): deterministic gate (`non-employment`) plus guide rule.
- Scams asking for fees, friend's job news, consumer "offers": guide rules; a 4B model still errs on some (the largest remaining precision loss).
- Prompt injection: guard + verification (above).
- Employer unknown on model-recognised mail: grounded candidates may be chosen; unique employer-domain linking; role only when title-like.
- Lifecycle linking across threads remains the weakest part (grouping recall 54-88% on hybrid).

## Operating it
```
# one-time (outside the repo): ~/.local/share/oi-semantic  (uv venv + mlx-lm), model downloaded from Hugging Face (weights only)
HF_HUB_OFFLINE=1 ~/.local/share/oi-semantic/.venv/bin/python -m mlx_lm server --model mlx-community/Qwen3-4B-Instruct-2507-4bit --host 127.0.0.1 --port 8089
# .env.local:  SEMANTIC_READER=local   (LOCAL_MODEL_URL, LOCAL_MODEL optional)   Remove it to roll back; stored data stays valid.
node --no-warnings --import ./scripts/loader/register.mjs scripts/eval-sealed.ts <fixture.json> --semantic     # hybrid evaluation
node --no-warnings --import ./scripts/loader/register.mjs scripts/semantic-local-eval.ts <fixture.json>        # model alone
```

## Hosted alternatives (NOT used; no private text was sent anywhere)
Only if local precision is judged insufficient. A hosted small model (for example `claude-haiku-5-5`) would see the same redacted, truncated text. At ~700 input +
~100 output tokens per message, 1,500 messages is about 1.5 M input and 0.15 M output tokens per first sync; cost scales with the provider's price sheet, latency
is ~1 s per message batched, and quality is expected to be higher than a 4B local model. The privacy cost is that redacted email text leaves the machine, which needs your
separate explicit approval and a no-retention endpoint. This document does not recommend it unless the local measurements below stay inadequate.
