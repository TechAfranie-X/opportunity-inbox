# Opportunity Intelligence v3: an evidence-based identity and lifecycle engine

Date: 2026-11-19. Branch `mvp`. Every number below is measured on SYNTHETIC mailboxes written by independent authors who never saw the code (kept outside the
repository). They are not accuracy claims about real mailboxes. Nothing here is model training: a pretrained local model is used as-is (see `docs/semantic-local.md`).

## 1. Diagnosis (before any change)

Baseline = commit `ab0e738`, rules plus the local 4B model ("hybrid"), on two fresh fixtures:

| Fixture | Recruiting P / R | Grouping pair P / R | Journeys split | Opportunities merging journeys | Status / outcome / stage | Review items (justified) |
|---|---|---|---|---|---|---|
| I (ATS-heavy, many companies) | 94.1% / 98.2% | 87.9% / **49.2%** | **23 of 42** | 4 | 78% / 63% / 51% | 42 (45%) |
| H (cycles, aliases, duplicates) | 94.5% / 99.0% | 92.6% / **51.1%** | **15 of 24** | 3 | 71% / 54% / 67% | 30 (23%) |

Finding: recognising recruiting mail was no longer the weak link (recall 98-99%). **Identity was**: half of all true links were missing. Causes, each shown on stored
fields and verified by dumping per-message decisions (no message text is stored):

1. **The sender was taken for the employer.** An applicant-tracking platform ("Greenhub-ats"), a mailbox provider ("Mailbox") or a subdomain became the company. One
   employer was therefore split into many names, and unrelated employers sharing a platform were merged.
2. **The model's correct employer lost the reconciliation** ("the rules were confident"), because a name that exists only in the sender's address looked confident.
3. **Organisation names were rejected as people.** `looksLikePerson` vetoed every two-capitalised-word name ("Orbital Maps"): 22 of 66 missed employers in fixture I.
4. **One employer, several spellings** ("Solstice" / "Solstice Robotics"; accents, hyphens) never unified.
5. **Grouping guessed.** A role-less message at an employer with two live applications joined the latest one; a role copied from an earlier message of a reused
   thread was treated as evidence about a later one; the no-employer path had no role/cycle check.
6. **The person's own reply was lost** when only the model (not the rules) recognised the thread, and acceptance was never read from it.
7. **Endings and lapses were typed wrongly**: an employer acknowledging the person's withdrawal read as a rejection; a lapsed offer was unreadable.
8. Review burden: a company name taken from a sender label stayed "uncertain" forever.

## 2. Architecture

```
messages (in memory) -> rule reader + ingestion facts -> [EMPLOYER PROVENANCE] -> local model (verified) -> assist / reconcile
   -> refine (gates, follow-up offers) -> [EMPLOYER IDENTITY] -> grouping with abstention -> reducer -> contradictions -> actions / review / Today / Pipeline
```

New and changed parts (all deterministic except the model's verified reading):

- **Employer provenance** (`lib/reliability/grounding.ts`, `employerProvenance`, applied to every event whatever reader made it). A name written in the message text is
  trusted; a name that exists only in the sender's name/address, or equals the sender's own domain, is marked `employer:sender-only` (weak). The employer's own sender label
  ("Copperline Careers", "Nordmarkt Logistik Karriere", "Dexi from Sodexo") names the employer even through a platform, if corroborated by the text or the domain's own labels;
  the longest run of label words the domain also spells wins, so a division is not lost to its parent. Person names, function-only labels and punctuation fragments never qualify.
- **Employer identity** (`lib/lifecycle/employer-identity.ts`, whole-record, no text needed):
  1. *thread employer*: a sender-only (or borrowed, for the person's own replies) name yields to the single employer other mail in the same thread writes in its text;
  2. *sender identity*: one sender that writes for exactly one employer elsewhere lends it, only when its own label carries the name (a platform's "Applicant Hub" never does);
  3. *aliases*: a leading-token prefix is one employer only when a shared Gmail thread, or a domain named for the employer, ties the spellings; a short name that could extend to
     two employers abstains; the best-supported spelling wins;
  4. *corroboration*: a weak name that another message's text also writes becomes "known", which removes its review item.
- **Grouping with abstention** (`lib/lifecycle/identity.ts`): thread and employer are evidence, weighed with role/cycle/program conflicts. A role copied from an earlier message
  (`role-inherited`) is not identity evidence. A role-less *consequential* message (rejection, offer, interview, assessment) at an employer with two or more live applications for
  different roles is **not guessed**: it stays on its own and says why (`ambiguous_identity`); a receipt or reminder rides with the latest application, marked. The same rule applies inside a reused thread.
- **Progress after a rejection in the same thread joins and is flagged** (`reopened`); a second `applied` after a rejection is a new opportunity.
- **Contradictions** (`lib/lifecycle/contradictions.ts`): `reopened`, `offer_ended`, `ambiguous_identity`, shown in Review as important items while live; a person's confirmation settles them.
- **Lifecycle facts**: the person's own explicit acceptance of an offer (their outbound words, multilingual, vetoed by refusal words, valid only after an offer), an employer
  acknowledging the person's withdrawal, an offer that lapsed unanswered (outcome `expired`), a follow-up "offer" a model typed after an explicit offer is a follow-up, receipts
  are retyped only to endings or offers, interview invitation vs scheduled decided from text facts for model-confirmed mail.
- **Employer verification fix**: a two-word organisation is a person only when the message itself shows a person by that name (the sender's display name or an entity the
  reader typed as a recruiter); generic interjections are never employers.
- **Key continuity**: opportunity keys changed meaning with better employer names, so the previous identity generation (`identity-v2.ts`, frozen copy) is replayed and its keys are
  translated by event membership into `legacyKeys`; overrides and dismissals made under an old key still resolve.
- **Identity backfill** (`scripts/backfill-identity.ts`, `backfillIdentity`): re-reads stored messages in memory (Gmail read-only, local model only), updates stored metadata. Idempotent
  (versioned mark), additive (updates, never deletes), never downgrades a shown or model-judged row, **never touches a row a person confirmed or corrected**, chunked with rate-limit retry.
- Rollback: unset `SEMANTIC_READER` for the model; the new identity logic is read-time and needs no data change (a stored replay is identical or better); `identity-v2.ts` keeps the old keys addressable.

## 3. Results

Journey harness: `scripts/eval-journeys.ts` (recruiting P/R, pairs, journeys split, opportunities merging journeys, status/outcome/stage per journey, next action as shipped
and with the clock set 3 days after the last message (the product time-boxes actions; the fixtures end months before their `now`), source-evidence correctness, contradiction
flagging, review burden and justification, time). Hybrid = rules + local Qwen3-4B, assist mode.

**Development fixtures (diagnosed and tuned on; contaminated, not evidence of generalisation):**

| | I baseline -> final | H baseline -> final |
|---|---|---|
| Recruiting P / R | 94.1 / 98.2 -> 94.9 / 98.2 | 94.5 / 99.0 -> 94.5 / 99.0 |
| Grouping pair P / R | 87.9 / 49.2 -> **100 / 93.2** | 92.6 / 51.1 -> 96.1 / 77.8 |
| Journeys split | 23 -> 3 | 15 -> 7 |
| Wrong merges (pairs) | 8 -> 0 | 9 -> 7 |
| Status / outcome / stage | 78 / 63 / 51 -> 90 / 76 / 73 | 71 / 54 / 67 -> 96 / 79 / 92 |
| Next action, evidence-only clock | 51 -> 81 | 58 -> 79 |
| Review items (justified) | 42 (45%) -> 23 (57%) | 30 (23%) -> 8 (50%) |

**Release gate J** (written independently, never inspected before its single run; run once on the baseline and once on the new code, before the last two fixes below):

| J (191 messages, 16 scenarios) | rules baseline | rules new | hybrid baseline | hybrid new |
|---|---|---|---|---|
| Recruiting P / R | 100 / 55.6 | 100 / 55.6 | 98.3 / 96.6 | 98.3 / 96.6 |
| Stage type | 53.8 | 56.9 | 76.1 | 77.0 |
| Grouping pair P / R | 92.9 / 85.8 | 94.8 / 80.3 | 92.9 / 78.4 | 92.2 / **85.6** |
| Wrong merges / missed links | 12 / 26 | 8 / 36 | 15 / 54 | **18** / 36 |
| Journeys split / opportunities merging journeys | 2 / 2 | 4 / 2 | 10 / 4 | **4** / 4 |
| Status / outcome / stage | 67 / 50 / 33 | 67 / 50 / 33 | 81 / 62 / 50 | **89 / 77 / 62** |
| Next action (evidence-only clock) | 57 | 57 | 68 | **84** |
| Contradictions flagged | 3/7 | 2/7 | 4/7 | 3/7 (2 by the explicit detector) |
| Review items (justified) | 16 (88%) | 16 (88%) | 51 (51%) | **34 (62%)** |

Honest reading of J: genuine detection is unchanged (no recall lost), lifecycle correctness and next action rose clearly, split journeys fell 10 -> 4 and review burden fell by a third.
**False merges did not fall (15 -> 18 wrong pairs, 4 opportunities merging journeys in both)**, and contradiction flagging did not improve. Inspection after the run (J is
contaminated from then on) showed two causes: (a) a parent and its division ("Nordmarkt Logistik" / "Nordmarkt Digital") were both reduced to the parent by the sender-brand rule
(fixed: the longest run of label words wins, with a test), and (b) two applications confirmed in one email with a reused thread, which no per-message identity rule can separate.

**Gate K** (a second fresh fixture, written independently after the J fixes; 203 messages, 182 inbound, 16 scenarios; run once on the baseline and once on the code at `b016170`):

| K | rules baseline | rules new | hybrid baseline | hybrid new, as measured | hybrid new, 5 failed model calls re-asked |
|---|---|---|---|---|---|
| Recruiting P / R | 100 / 66.9 | 100 / 66.9 | 97.6 / 96.1 | 97.5 / **92.9** | 97.6 / 96.1 |
| Stage type | 58.8 | 58.8 | 85.2 | 87.3 | 86.9 |
| Grouping pair P / R | 80.4 / 71.7 | 78.9 / 84.2 | 77.9 / 64.8 | 79.5 / 74.9 | 78.7 / 74.3 |
| Wrong merges / missed links | 21 / 34 | 27 / 19 | 33 / 63 | **33** / 43 | **36** / 46 |
| Journeys split / opportunities merging journeys | 8 / 5 | 5 / 5 | 18 / 8 | 11 / 8 | 12 / 9 |
| Status / outcome / stage | 58 / 50 / 39 | 58 / 46 / 52 | 77 / 56 / 67 | 82 / 68 / 82 | 82 / 68 / 82 |
| Next action (evidence-only clock) | 67 | 76 | 74 | 81 | 81 |
| Source evidence | 90 | 100 | 83 | 100 | 100 |
| Contradictions flagged | 2/7 | 4/7 | 2/7 | 3/7 | 3/7 |
| Review items (justified) | 27 (70%) | 29 (69%) | 26 (31%) | 24 (25%) | 24 (25%) |

The "as measured" recall dip is an infrastructure artifact, not a logic change: five model calls timed out in that run (the local server was slow, 1035 s against 583 s) and the product
fails closed on a missing reading. `--fill-missing` re-asked exactly those five messages with unchanged code (recall back to 96.1%). Both columns are reported.

**What the gates show.** Fresh, independent evidence supports: more complete grouping (recall 78 -> 86 on J, 65 -> 74 on K), far fewer split journeys (J 10 -> 4, K 18 -> 11), better
lifecycle correctness (J status/outcome/stage 81/62/50 -> 89/77/62, K 77/56/67 -> 82/68/82), better next-action (J 68 -> 84, K 74 -> 81), source evidence 83-100%, and, on J, a third fewer
review items. **It does not support "false merges reduced"**: wrong merges were 15 -> 18 on J and 33 -> 33/36 on K, and review justification fell on K (31% -> 25%). The remaining merges are
two or more applications to one employer whose receipts and updates name no role (shared label, reused thread, "Application update" for everything). Three rules were added after
inspecting J and K and are therefore NOT evidence on those fixtures (they were exercised against them afterwards: J wrong merges 18 -> 5, K 36 -> 32): the longest-run sender brand,
lifecycle consistency as a tie-breaker (a finished assessment can only follow an assessment that was sent), and "one receipt per application" (a role-less receipt in another thread
more than half a day after an earlier receipt starts another application). The next independent fixture is the only valid test of them.

## 4. Real accounts (local model, nothing left the machine)

Replays of stored events plus the identity backfill (both accounts), before -> after:

- Account 2: names cleaned (no sender-derived "Mailbox"/"Hiretrack-ats" style companies), the Allstate offer card, the accepted ATS offer (23 events) and Today's "Offer decision" are intact;
  Review shows "Nothing important to review" (housekeeping items remain); pipeline 15 -> 17 active, 6 -> 8 closed. The Today page was checked in the browser.
- Account 1: 114 -> 111 active, 64 -> 69 closed (duplicate and junk names merged or closed). Not click-verified in a browser this session (the browser is signed in to account 2 only).
- **Incident and repair.** The first backfill overwrote the underlying reading of rows the owner had *confirmed* (a welcome message became an "offer"). 139 corrected rows were
  re-derived with the previous reader and written back; the backfill now skips every corrected or confirmed row, and the rule is in memory. User-confirmed rows, ignores and
  `linkedTo`/`separate` constraints are preserved; the audit views before and after agree on the key offers.
- Two more real-data defects were found only on real mail and fixed with tests: a receipt retyped as an assessment, and employer names such as "FYI" or "(Gen)".

## 5. Security and privacy

- Local model only (loopback), no hosted calls, no training; prompts and bodies are not stored. The injection guard from M30 still runs before the model. Text facts read the
  message's own wording and can be spoofed like any rejection email (an email claiming "your withdrawal" can end an opportunity that email's sender already belongs to); every such
  change is visible in Review via contradictions and reversible with one click.
- Per-account isolation: every function operates on one account's record; no module state; scripts take one `sub`. The backfill writes only to that account's rows.
- Outbound bodies are read in memory only to find an explicit acceptance; only the signal `student:accepts` is stored.

## 6. Remaining limitations

- A message that confirms two applications at once and threads that reuse one subject for several roles cannot be separated without role text; they are kept apart or flagged, sometimes split.
- Contradiction recall is partial (a conflict between "submitted" and "not received" claims is not detected).
- The 4B model still has false yeses (marketing, notification mail) and misses some employers; extraction of the employer from prose in other languages is the largest remaining lever.
- Next action as shipped is time-boxed by design; a fixture's authors expected evidence-only behaviour.
- Fixtures A-J are contaminated after inspection; a new sealed fixture is needed for any external claim.


## 7. Release thresholds (written BEFORE the last gate, fixture M, was run)

On one fresh independent fixture, hybrid new vs hybrid baseline (`ab0e738`):
1. recruiting precision and recall each within 1 point of the baseline (no genuine detection traded away);
2. wrong-merge pairs at least 25% fewer than the baseline;
3. status, outcome and stage accuracy each not lower than the baseline;
4. justified share of review items not lower than the baseline, and fewer review items;
5. next-action (evidence-only clock) and source-evidence correctness not lower.
All five must hold. A fixture is never re-run for tuning; a failed threshold is reported as failed.

Gate L (fresh, run once on `b1559c1`, before the unit-evidence and borrowed-role fixes): recruiting 98.6 / 96.5 both runs; wrong merges 40 -> 32 (-20%, threshold 2 FAILED); status 85.3 -> 82.4, stage 79.4 -> 73.5 (threshold 3 FAILED), outcome 58.8 -> 61.8; review 46 -> 9 items, justified 26% -> 67% (4 met); next action 80.8 -> 88.5, source evidence 90 -> 100 (5 met). Inspection after the run found two general causes, both fixed afterwards (L is now contaminated): reply/continuity events carried their anchor's borrowed role into the wrong application, and the hiring unit named in the body ("the Patient Finance team") was not used as identity evidence.
