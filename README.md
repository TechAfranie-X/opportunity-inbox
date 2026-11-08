# Opportunity Inbox

Candidate-side recruiting memory and control center. It rebuilds your recruiting emails into clean company and role histories, shows what needs you now, and keeps the message text out of its database. Product definition, privacy, limits and test flows: [docs/mvp.md](docs/mvp.md). Earlier scope notes: [docs/validation-mvp.md](docs/validation-mvp.md).

## Run it locally
Prerequisites: Node 22+, Docker (for Postgres).

```bash
npm install
cp .env.example .env.local   # AUTH_SECRET, TOKEN_ENCRYPTION_KEY, and Google OAuth values for real Gmail
npm run db:up && npm run db:migrate
npm run dev                   # http://localhost:3000
```

### Without Gmail: the sample mailbox
Add `SAMPLE_LOGIN=1` to `.env.local`, restart `npm run dev`, open the landing page and choose **Try with a sample mailbox (development)**. A synthetic mailbox of about 100 emails is read locally; nothing touches Google. It is always disabled when `NODE_ENV=production`.

To keep a sample session next to a real sign-in, open the app at `http://127.0.0.1:3000` (sample) and `http://localhost:3000` (real): browsers keep separate cookies for each.

### With Gmail
Set the Google OAuth values in `.env.local`, then **Continue with Google** and **Connect Gmail**. Mail received on or after the evaluation cutoff (2026-12-01) is intentionally not read; see the embargo section of [docs/mvp.md](docs/mvp.md).

## Checks
```bash
npm test                # unit tests
npm run test:guard      # evaluation-freeze guard tests
npm run e2e:sample      # end to end on a throwaway Postgres database (needs Docker and the db running)
npm run lint
npx tsc --noEmit
npm run build
```

## Branches
`main` is the frozen evaluation environment; product work happens on `mvp` in a separate worktree. See [docs/development-workflow.md](docs/development-workflow.md) before committing to `main`.
