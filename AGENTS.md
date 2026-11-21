# Opportunity Inbox Engineering Rules

## Product scope
Opportunity Inbox helps students understand career opportunities already present in their email.

The V1 must answer:
1. What opportunities do I currently have?
2. What needs my attention?
3. What am I at risk of missing?

Do not add features outside the current milestone unless explicitly requested.

## Engineering principles
- Prefer the simplest implementation that correctly satisfies the current requirement.
- Keep changes small and reviewable.
- Do not introduce new dependencies unless they are necessary.
- Explain significant architectural decisions before implementing them.
- Do not perform large refactors unless explicitly requested.
- Avoid premature abstractions.
- Preserve clear boundaries between UI, business logic, integrations, and persistence.
- Validate external data before trusting or storing it.

## Decision-logic changes (mandatory gate)
- Any change to how a message is read, typed, attributed, decided or turned into a lifecycle (`lib/recruiting`, `lib/reliability`, `lib/semantic`, `lib/lifecycle`, `lib/identity`, `lib/decision`, `lib/ledger`, `lib/discovery`) must pass the cached-replay gate before it is committed: `npm run eval:gate` (a few seconds, no model call, no Gmail). `npm test` runs it too.
- The gate replays the frozen development fixtures in `eval/dev` against `eval/baseline.json`. A fixture or cache change invalidates the baseline; rewriting the baseline is deliberate (`--write-baseline`, with a note) and is never done to make a regression disappear.
- A guard that removes evidence needs a test that fails without it, and must be measured on the replay first. Prefer weighing a claim in the decision engine to deleting it.
- Never tune against a fixture whose failures were inspected and then call it generalisation evidence. The fresh sealed fixture stays outside the repository.
- `npm run hooks:install` enables the pre-commit hook that runs the gate when decision-logic files are staged.

## Security and privacy
- Never expose secrets in client-side code.
- Never commit API keys, OAuth secrets, access tokens, or refresh tokens.
- Never log Gmail message bodies, OAuth tokens, or other sensitive user data.
- Use least-privilege permissions.
- Raw Gmail message bodies should not be permanently stored unless explicitly required.
- Gmail-derived information must remain traceable to its source without unnecessarily copying private content.

## AI-assisted development
- Optimize for both working software and developer understanding.
- Before major implementation work, explain the proposed approach and files that will change.
- Do not hide complexity behind generated code.
- If an important concept is introduced, explain why it exists.
- Prefer readable code over clever code.

## Quality
- Run lint after meaningful changes.
- Add tests when behavior becomes important enough to regress.
- Do not silence errors merely to make builds pass.
- Fix root causes when reasonably possible.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
