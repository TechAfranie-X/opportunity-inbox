# Opportunity Inbox: the personal MVP (state of 2026-11-21)

Runs locally against the owner's own Gmail (read-only), with the local model on this machine. No paid service, no public deployment, no data leaves the machine. Branch `mvp`.

## What works, verified on the real mailbox (account 1; read-only checks, nothing stored)
| Claim | How it was checked | Result |
|---|---|---|
| The pipeline contains real applications | 123 "applications" that existed only because the model said so were fetched and judged; 66 rule-found single-event applications likewise | Model-only: almost none were the student's own (job alerts, event registrations, verifications, marketing, a person's reply). Rule-found: about 90% genuine |
| Offers are real | all 19 offer events fetched | Genuine ones (Salesforce, Alcon, Stanford/SLAC) are rule-found with matching text and dates. The false ones (a bootcamp reservation, a "you're invited" course, two marketing mails, a form thank-you) were all model-only |
| Rejections are real | all 72 fetched, sentence-level check | 68 contain a real ending sentence; the other 4 are receipts typed as rejections (now proposed, not settled) |
| Dates are not fabricated | all 61 dated interviews/assessments: does the stored date occur in the message? | 61 of 61 |
| The new decision engine is safe on real mail | 140 real consequential messages through the production chain and the Phase 2 engine with the real local model; 27 on account 2 | 135 of 140 identical (27 of 27 on account 2); of 5 differences, 3 favour Phase 2, 1 neutral, 1 questionable (since closed by a guard) |
| Source links work | opened a Review card's "Open in Gmail" in the browser | Lands on the exact message; Gmail shows the same interview time Today shows |

## What changed in the product (all view-time or new-mail only; stored events and corrections are never rewritten)
| Change | Effect on the real account | Rollback (set the variable to `off`, restart) |
|---|---|---|
| **Entry policy**: a model-only reading cannot create an application; it waits collapsed as "possible" until the person confirms | pipeline from about 260 active entries to about 146 jobs; Review badge 145 to 18 | `ENTRY_POLICY=off` |
| **Identity options** that need no extra model calls (distinct-thread receipts, weak-employer threads, ending confirmation, requisition and same-appointment identity) | development-set wrong merges 64 to 33 | `IDENTITY_V3=off` |
| **Review prioritisation**: "needs you" versus collapsed suggestions, repeated questions folded | needs-you justification 54% to 73% (development set) | `REVIEW_PRIORITY=off` |
| **Phase 2 decision engine for NEW mail**: proposed endings never settle on one reading; an everyday ending sentence corroborates; offers that the text says are welcome/programme notices are contested; rule rejections without an ending sentence are only proposed | applies to mail read from now on | `DECISION_ENGINE=off` |
| One interview is never shown twice; the same scheduled moment is one application | Today no longer shows the Harvey interview twice | (code, no switch) |
| Two uncorrected stored rejections that were receipts (one per account) are marked proposed | those applications stay active | `scripts/stamp-proposed-endings.ts <sub> --rollback <backup>` (backups are in `~/.opportunity-inbox-sealed/`) |

## Run it
`docker compose up -d` (database), the local model server on 127.0.0.1:8089, `npm run dev`, open http://localhost:3000. Read-only verification tools: `scripts/verify-model-only.ts`, `verify-rule-found.ts`, `verify-consequential.ts`, `compare-engines-real.ts`, `mvp-audit.ts` (each takes the Google sub; they print short labels, never store text).

## What remains unsafe or imperfect (stated, not hidden)
1. **Some applications are still grouped wrongly.** Harvey (three overlapping processes in 2026 and 2027) is the worked example: one 42-event group mixes a 2026 application with 2027 messages, and Today lists three Harvey actions. Wrong merges fell by about half on the development set but are not zero.
2. **Programs, events and fellowships can still look like applications** when the rule reader found a receipt-like message (for example "Spring 2026 Building AI Agents Program" entries listed as "Unknown company"). They are reversible (hide or correct) but not filtered.
3. **Recall cost of the entry policy**: a genuine application that only the model found (for example a "We received your Claude Corps application" the rules missed) waits under "possible" until you confirm it. About 190 such items are collapsed on account 1; the real ones are few.
4. **Legacy lifecycle accuracy is lower by design**: a single uncorroborated reading no longer closes an application, so some true rejections show as "proposed" rather than closed.
5. **A program acceptance** ("Congratulations, you're in") can still be read as an offer when the rule reader found it; the engine now contests such offers on NEW mail only.
6. **Stored history was not re-read.** New decision logic applies to new mail; the entry policy and identity options apply to everything at view time; old rule-found rejections that lacked an ending sentence were fixed only where no person had confirmed them (confirmed rows stay as the person left them).
7. **Account 2 is not browser-verified** (it needs its owner to sign in); its data was verified at database and Gmail level only.
8. **The 15 historical corrected rows are unchanged** (repair plan and token are ready; it needs the owner's separate authorisation and does not block anything).
9. Evaluation on fixtures is by one author on small sets; fixtures are development evidence, not proof of generalisation. A real labelled sample from the owner would be the next honest measurement.
