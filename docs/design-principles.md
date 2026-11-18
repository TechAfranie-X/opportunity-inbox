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
The product should feel like it already understood the person's recruiting and quietly says what matters: **quiet by default, decisive when something matters.**
One dominant thing per screen; everything else recedes or folds.

| Screen | Its question | Composition |
|---|---|---|
| Today | What needs me now? | A greeting that says where to begin (not an alarming number); one lead card with the single primary action; two decision-sized cards beside it; everything else folded ("46 more need you", "20 later", "18 waiting on replies"). Beside it, the state of things: a compact neutral pipeline summary, what changed, and a review panel that counts only reviews that matter. When nothing needs you: "You are all caught up." |
| Pipeline | Where does everything stand? | The opportunity is the unit. "All active" is a compact board that reads left to right as the journey, a handful of cards per stage (dated things first), the rest one click away; a stage opens as a card grid; a filter narrows. Cards show who, what, what is next or just moved, and whether we are unsure. Swipeable lanes on phones. Usable at 100+ opportunities. |
| Opportunity | What is this one's story? | Identity, then "how it got here": the stages reached with the day each was reached, where it stands and what is next; then the history as a rail with the time between messages made visible. It reads as memory, not email. |
| Needs review | What am I unsure about? | A triage over the reviews that matter to live recruiting: "1 of 8 important reviews", one decision at a time, "We think this is ...", "Why we are unsure", the evidence, and Looks right / Fix details / Not recruiting (Y, F, N, S). Housekeeping and weak suggestions are folded and never counted. |
| Landing | What is this and can I trust it? | The whole transformation as the picture: Gmail on the left, Pipeline cards in the middle, Today's actions on the right, built from the product's own styles; then Today, Pipeline, History in one line each, and four trust facts. |

## Company identity
Identity first, mark second (`lib/identity`): the resolved, canonical employer name decides everything; a mark never chooses a company. The mark is looked up by that name: (1) a curated full-colour asset in `public/brands` (Harvey, Ramp, Plaid, Figma, Google, Slack, Toast, Waymo, Neuralink, Brex), else (2) a bundled glyph drawn in the company's official brand colour (about 90 companies, simple-icons CC0), else (3) a monogram. Nothing is fetched at run time.
One component (`EntityMark`), one size scale (sm 28, md 36, lg 44, xl 56 on the detail page), used on every surface. The mark sits on a neutral tile (white in light theme, a soft paper tone in dark: never pure white), inset with padding; app-style icons (Harvey, Neuralink, Brex) fill the tile; marks too light for the tile (Snapchat, Robinhood, Sony) sit on a dark tile; near-black brands (Notion, Vercel, GitHub) are simply black, which is their identity. No per-brand backgrounds, no glow, no tints.
**Known**: the mark, no decoration. **Likely**: the same mark, untouched, in a dashed ring (and "Likely company, needs confirmation" for assistive technology). **Unknown**: a dashed placeholder. A company without a public mark keeps the monogram. Never a guessed logo.
To add a company: add an entry to `lib/identity/brand-assets.ts` (and the file to `public/brands`, with its source in `SOURCES.md`).

## Navigation
Two destinations: Today and Pipeline. Search (⌘K), a review status ("3 need review", only when something important needs you), and the account menu. Activity is reached from Today ("All activity") and search.

## Rules we follow
- One dominant thing per screen; secondary things quieter; supporting analytics never compete with work.
- Progressive disclosure, not removal: every capability remains.
- Sentence case. No tracked capitals, no decorative numbering (numbers appear only for a real sequence).
- The preview on the landing page is the product, built from the product's own styles.
- Honest copy: what the landing page says about privacy is what the product does.

## Accessibility
Text and controls meet AA contrast in both themes (checked on every screen with an in-page audit of computed colours); one h1 and a main landmark per page; every control has a name;
focus is a crisp 2px outline; disclosures use `aria-expanded` and make hidden content `inert`; motion respects `prefers-reduced-motion`; all of it works at phone width.
