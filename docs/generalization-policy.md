# Generalization policy (permanent)

Opportunity Inbox must understand recruiting mail from users it has never seen. The two audited mailboxes are development and diagnostic data, not proof of generalization.

## Rules
1. **No example-specific logic.** No employer, sender, person or subject strings from an audited mailbox in code, rules or lists. Fixtures use invented names (`.example` domains). A rule must be statable as a general failure pattern.
2. **Every intelligence change records its pattern** (in `docs/autonomous-qa-progress.md`) and ships positive and negative tests, including legitimate recruiting mail that resembles the excluded category.
3. **Held-out sets stay sealed.** Run once per milestone, never tune against answers. Any scenario whose failure was inspected is **contaminated** for unbiased evaluation; fix the general pattern, add original tests, and measure on a new fixture written by an author who has not seen the code (`scripts/eval-sealed.ts`).
4. **Deterministic logic is not training.** Everything here is rules and heuristics. No model is fine-tuned and no private email is used for training without separate explicit authorization.
5. **Report unseen-case performance**, with the caveat that rule authors have seen the categories, not the cases.

## Contaminated sets (do not use for unbiased claims)
- Account 1 and account 2 stored events (development/diagnostic).
- Held-out synthetic seed 20261118: the cancelled-interview family was inspected before its rule was written.
- Sealed fixture A (see progress file) after its first failures are inspected.
