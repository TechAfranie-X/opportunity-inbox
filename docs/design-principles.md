# Design principles

Opportunity Inbox answers three questions, in this order: **What needs me? What changed? Where does every opportunity stand?**
Each screen answers one of them. Anything on a screen that does not help answer its question is folded, moved, or removed.

## Quiet until it matters
Do not compete for attention you have not earned. One dominant thing per screen; the next few things beneath it; everything else
present but folded. Colour carries meaning (blue marks the primary action and the current place; red marks only time-critical text).

| Screen | Its question | What is visible | What is folded or elsewhere |
|---|---|---|---|
| Today | What needs me now? | The greeting and count, one hero card, up to 3 "also needs you" and 3 "coming up" rows, one footer line | The rest of each list ("Show N more"), "Waiting on replies", stage counts (Pipeline), what changed (Activity) |
| Pipeline | Where does everything stand? | Active and closed counts, the six stages with counts, the rows of one stage | An opportunity's detail (inspector, one click) |
| Activity | What changed? | Newest first, grouped by day | Earlier days |
| Check | What am I unsure about? | One sentence per item and three actions | The correction form ("Fix details") |
| Opportunity | What is this one's story? | Where it stands and what is next, then the timeline | Per-entry correct/open email until hover or focus |

## Rules we follow
- **Navigation recedes.** Inactive tabs are quiet; refresh is an icon; words (syncing, error) appear only when there is something to say.
- **One column.** Pages share one centred reading column so the edge never jumps between tabs; the opportunity page is wider only because it has a side column.
- **Progressive disclosure, not removal.** Capabilities stay (correct, confirm, hide, close, search); they appear on request.
- **Sentence case, no tracked capitals.** Eyebrow labels and decorative numbering are not used; numbers appear only for a real sequence (the three setup steps).
- **The preview is the product.** The landing page shows the real Today screen, built from the product's own styles, and links to the live demo.
- **Honest copy.** What the landing page says about privacy is what the product does (it keeps company, role, stage, dates and the subject line, never message text).

## Accessibility
Text and controls keep AA contrast in both themes (filled buttons use #2563EB under white text; link text is #60A5FA on dark and #1D4ED8 on light);
focus is a visible ring; disclosures use `aria-expanded` and make hidden content `inert`; motion respects `prefers-reduced-motion`.
