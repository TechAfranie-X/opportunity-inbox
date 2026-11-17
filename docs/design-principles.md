# Design principles: a quiet ledger

Opportunity Inbox is a personal recruiting command center, not an inbox and not a table. It answers three questions in order:
**what needs me now, what changed, where does everything stand.** Each screen answers one of them.

## Thesis
An editorial record of one person's recruiting life. Calm, precise, mature, understated.
- **One matte surface for the work.** A bordered panel holds what needs you and the timeline. Everything else is paper and hairlines. No glow, no gradient, no glass, no floating objects, no icon tiles.
- **Type does the hierarchy.** A serif (Newsreader) sets titles and the greeting; a precise sans (Instrument Sans) sets everything operational. Tabular numerals for counts and times.
- **Colour is information.** Blue marks the active place, the primary action, links, focus and the current step, and nothing else. Red is for time-critical text, amber for "to check", green for success. Stages are never colour-coded.
- **Small, few radii** (4, 6, 8px), flat controls, depth only where something floats (menus, the inspector).
- **Two destinations.** Today and Pipeline. Activity is reached from Today ("All activity") and search; Check is a status in the navigation that appears only when there is something to check.

## What influenced what (principles, not looks)
- **Linear** (its 2024 and 2026 refreshes): not every element carries equal weight; the task stays in focus while navigation recedes (muted inactive items, compact tabs, unified headers); dense but never loud.
- **Vercel / Geist**: restraint as the product; near-black rather than pure black; strong typography; high-contrast accessible colour.
- **Attio**: one tight density; a record page that is the canonical memory of a thing, with its attributes beside its history.
- **Mercury**: editorial calm, generous whitespace, numerals treated as content.
- **Raycast**: keyboard-first, search as a way to move, small bordered key hints.

## Screens
| Screen | Its question | Composition |
|---|---|---|
| Today | What needs me now? | A needs-now panel led by one item with one primary action, then a few more, folded beyond four; a compact schedule; folded "waiting on replies". Beside it, the state of things: a neutral pipeline summary, what changed, the review status. When nothing needs you it says so, plainly. |
| Pipeline | Where does everything stand? | A rail of stages with counts and a filter. "All active" reads from the most advanced stage down with five rows each and the rest one click away, so it stays calm at 100+ opportunities; a stage lists all of it. |
| Opportunity | What is this one's story? | Company and role; a stage, next-step and people panel; then the history as the strongest surface: a rail with a marker per message, dates in a gutter, and the time between messages made visible. |
| Check | What am I unsure about? | A triage, not a list: the most consequential uncertainty first (ranked by impact on live recruiting), one decision at a time, resolved from the keyboard (Y, F, N, S). Housekeeping and weak suggestions are folded. |
| Landing | What is this and can I trust it? | An outcome headline, one primary action, the demo, and the product itself as the picture: recruiting email on the left, the Today command center on the right. Three steps, four trust facts, one final action. |

## Rules we follow
- One dominant thing per screen; secondary things quieter; supporting analytics never compete with work.
- Progressive disclosure, not removal: every capability remains.
- Sentence case. No tracked capitals, no decorative numbering (numbers appear only for a real sequence).
- The preview on the landing page is the product, built from the product's own styles.
- Honest copy: what the landing page says about privacy is what the product does.

## Accessibility
Text and controls meet AA contrast in both themes (checked on every screen with an in-page audit of computed colours); one h1 and a main landmark per page; every control has a name;
focus is a crisp 2px outline; disclosures use `aria-expanded` and make hidden content `inert`; motion respects `prefers-reduced-motion`; all of it works at phone width.
