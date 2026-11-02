# Opportunity Inbox

Candidate-side recruiting memory and control center. See [docs/validation-mvp.md](docs/validation-mvp.md) for scope, architecture, privacy and metrics.

```bash
npm install
cp .env.example .env.local   # fill in Google OAuth, AUTH_SECRET, TOKEN_ENCRYPTION_KEY
npm run db:up && npm run db:migrate
npm run dev                   # http://localhost:3000, try /demo without logging in
npm test                      # unit tests
npm run eval:extraction       # extraction accuracy on labelled fixtures
npm run lint
```
