# Validation MVP: candidate-side recruiting memory

Hypothesis: Opportunity Inbox is the candidate's recruiting memory and control
center. Connect Gmail and it reconstructs the lifecycle (applied, assessment,
recruiter, interview, offer or outcome) from real emails, then says what needs
attention today.

## What exists
| Experience | Where | Code |
|---|---|---|
| Pipeline reconstruction | `/pipeline` | `lib/recruiting/{extract,company,dates,opportunity}.ts` |
| Today / Action Center | `/today` | `lib/recruiting/actions.ts` |
| Opportunity timeline + corrections | `/opportunities/[key]` | `app/components/recruiting-views.tsx`, `lib/recruiting/corrections.ts` |
| Demo (synthetic data, no login) | `/demo` | `lib/recruiting/{fixtures,demo}.ts` |
| Operator metrics | `/admin/validation` (`ADMIN_EMAILS`) | `lib/recruiting/metrics.ts` |
| Old classifier + labelling UI | `/dev/inbox` (dev only) | `lib/opportunities/*` |

## How it works
1. **Sync** (`lib/recruiting/sync.ts`): a Gmail search over-fetches recruiting-looking mail from the
   last 365 days (cap 200 messages). Bodies are read in memory only. For threads that matched, the
   user's own sent messages are fetched as **metadata only**, so we know they replied without reading what they wrote.
2. **Extract** (`extract.ts`): rules turn each email into an `ExtractedEvent` with type, company, role,
   date (deadline or scheduled), confidence and the signals that fired. The old metadata classifier acts as a noise veto.
3. **Group** (`opportunity.ts`): same thread, then same company and matching role, then latest opportunity at that company.
4. **State**: stage is the latest stage-bearing event; rejection, offer and withdrawal set the outcome.
   Opportunities are derived on read, so corrections apply immediately and there is no stale derived state.
5. **Actions** (`actions.ts`): assessment deadlines, upcoming interviews, interview invites awaiting a reply,
   unanswered recruiters, offer decisions, and follow-up nudges. Each has a bucket (overdue, today, this week,
   worth a look) and a priority score. "Done" dismissals persist by stable action id.
6. **Corrections**: edits are stored beside the extracted values (`recruiting_events.correction`) and survive re-sync.
   Editing company or role regroups an event, which also covers merge and split. Events can be hidden, and
   opportunities can be closed or reopened.

## Privacy: what is stored and why
| Stored | Why |
|---|---|
| Gmail message id and thread id | Deep link back to the email; dedupe on re-sync |
| Sender display name and domain, subject | Show the user which email an event came from |
| Event type, company, role, date, confidence, signals | The product itself; signals make errors debuggable |
| User corrections | Persist edits; double as ground truth |
| Dismissed action ids, opportunity open/closed overrides | UI state |
| Sync time and counts, coarse usage events (`view_today`, `correction`, ...) | Validation metrics; contain no content |
| Encrypted Gmail refresh token (existing) | Re-sync |

**Not stored:** message bodies, snippets, attachments, the user's sent-mail text. The `recruiting_events` table
has no body column. Logs record only the error class. The pipeline page has **Delete my derived data** and
**Disconnect Gmail & delete everything**. Subjects can still contain private detail, so treat the database as sensitive.
Scope remains `gmail.readonly`.

## Accuracy tooling
- `npm run eval:extraction` scores type, company, role and date accuracy and noise rejection against labelled emails (`lib/recruiting/eval.ts`).
- **Caveat:** the bundled fixtures are synthetic and written alongside the rules, so 100% on them is a regression
  guard, not an accuracy claim. Real accuracy will come from tester corrections: `/admin/validation` shows the
  correction rate per tester and per field. Next step: add redacted real emails (with consent) as labelled fixtures.

## Known limitations
- Extraction is rule-based and English-only. It will miss unusual phrasing and ATS-specific formats. The
  extraction interface is stable if an LLM pass is added later, which would be a privacy decision because bodies would leave the server.
- Dates are timezone-less ("floating"). Day-level accuracy only.
- Sync is manual (button, plus auto-run on first visit), capped at 200 messages, and takes one request. No background job yet.
- Only inbound mail matching the search, plus the user's replies in those threads, is seen. Inbound replies without
  recruiting keywords (for example "sounds good!") are not events.
- Opportunity keys derive from company and role, so editing both can orphan an open or closed override.
- Not yet run against a live Gmail account or Postgres in this environment (no Docker). See "Before testers" below.

## Before testers
1. `npm run db:up && npm run db:migrate` (migration `0001` adds the new tables).
2. Set `ADMIN_EMAILS`; Google OAuth must list each tester as a test user.
3. Connect your own Gmail first and read the corrections you'd make. Fix the rules before inviting others.

## Measuring the six validation questions
| Question | Signal |
|---|---|
| Value immediately | events extracted on first sync; time to first Today view |
| Trust | correction rate (lower is better); `ignored` share |
| Discovery | tester interviews, "did it show something you'd forgotten?"; events per tester |
| Repeat use | `view_today` count, `returnDays` |
| Corrections | corrections by field |
| Return unprompted | `returnDays` with no reminder sent |
