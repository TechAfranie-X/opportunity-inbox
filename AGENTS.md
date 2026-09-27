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