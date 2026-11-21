# Independent validation workflow

The frozen set is **development data now**: its failures were inspected while Milestone 2 was built, so it cannot support a final accuracy claim. A claim needs either a second evaluator on a *fresh* set, or a fresh sample from the real mailbox that nobody has looked at.

## Files (all outside the repository except the hash)
- `~/.opportunity-inbox-validation/validation-v1.json`: frozen labels (message ids and verdicts only; no text). Its sha256 is `docs/validation-set.sha256`; `scripts/validation-metrics.ts` refuses to run if the file changed.
- `~/.opportunity-inbox-validation/review.html`: the reviewer sheet. One row per message with a Gmail link and agree / disagree / unsure. Downloads `validation-verdicts.json`.

## Steps for a second evaluator (about 30 minutes for 91 messages)
1. Open `review.html` in a browser signed in to the mailbox owner's Gmail.
2. For each row click the link, read the message, mark the label **agree**, **disagree** or **unsure** (a note is optional).
3. Click "Download verdicts" and send `validation-verdicts.json` back.

## What the owner sees
`node --env-file=.env.local --no-warnings --import ./scripts/loader/register.mjs scripts/validation-resolve.ts <verdicts.json>` prints only the rows the evaluator did not agree with, with both opinions and the Gmail link. Everything else is settled without the owner.

`scripts/validation-metrics.ts <sub> --verdicts <verdicts.json>` then scores the product with disputed items excluded.

## Fresh set (required before any final accuracy claim)
Draw a new sample the development work has not seen: new journeys from the mailbox (for example the messages received after the freeze date), freeze it with `scripts/validation-freeze.ts` under a new version name and hash, and have the second evaluator label it *before* anyone looks at how the product does on it.

## Known label dispute already found
`1a151c21` (NVIDIA, Oct 2026): the owner's own earlier correction said "rejection"; the message text is a receipt ("your application … has been received"). The owner agreed it was mislabelled and authorized the correction (done through the product's edit path; backup `~/.opportunity-inbox-sealed/nvidia-1a151c21-correction-backup.json`).
