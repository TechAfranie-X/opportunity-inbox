# Audit findings tracker (second-account audit, S2-F01..F16)

Status as of 2026-11-18, branch `mvp`. "Verified" says how: **unit** (synthetic regression tests), **stored** (the audited account's stored events replayed read-only through the current code), **browser** (real app, first account only; the second account cannot be signed in from this environment). Nothing here was checked against live Gmail.
The first audit (F-01..F-14, cross-cycle merging etc.) is tracked by the lifecycle benchmark (`benchmarks/lifecycle/`, `known-failures.json`).

| ID | Sev | Root cause (confirmed) | Fix | Verified |
|---|---|---|---|---|
| S2-F01 wrong Gmail account | Critical | `gmailThreadUrl` hard-coded `/mail/u/0/` | `?authuser=<connected address>`, no slot; one client component | unit (6), browser (links on pipeline/detail; no click-through to Gmail) |
| S2-F02 missed offer | Critical | Reader's offer pattern lacks "congratulations … offer"; the message was stored as a near miss (`status_update`, conf 0.3) and set aside | refine: explicit offer wording becomes `offer`, near-miss cleared | unit, stored (Allstate 2026 now Offer). **Open:** the Oct 23 Summer 2027 offer message has no stored prediction at all; not found in the local database, so not fixed and not proven missing in Gmail |
| S2-F03 false Capital One offer | Critical | newsletter text typed `assessment` then shown as an offer-stage card | context gate excludes newsletters/digests | unit, stored |
| S2-F04 stale Allstate lifecycle (x2) | Critical | offer never recognised; employer variant "Allstate Insurance Company and the" built a second opportunity | offer promotion, onboarding retype, entity cleanup and suffix merge | unit, stored (one 2026 card, stage Offer) |
| S2-F05 Futureforce active + closed | High | course sessions after the rejection opened a second active opportunity | course/practice sessions excluded | unit, stored (one closed card) |
| S2-F06/F07 mock interviews, newsletters | High | no recruiting-context gate | gate: newsletter, practice, course, consumer-account (ATS senders never excluded) | unit, stored; checked that account 1's real applications at finance employers are kept |
| S2-F08 Sodexo role/later outcome | High | role and outcome exist only in message bodies, which are not stored | **Not fixed** (needs re-reading the body; belongs to ingestion) | stored (still no role) |
| S2-F09 Two Sigma incomplete application | High | "Incomplete Application" read as recruiter outreach | retyped as an unfinished-application nudge | unit, stored |
| S2-F10 Ramp split in two | High | assessment name "Ramp 2025" became an employer | trailing year stripped from employer | unit, stored (one Ramp card) |
| S2-F11 Robinhood consumer mail | High | no consumer-account gate | gate (subject patterns; bank/broker domain only for account-application wording) | unit, stored |
| S2-F12 Today "caught up" with reviews | High | empty state ignored the review queue | copy acknowledges waiting checks | browser (first account has none waiting; copy path not exercised live) |
| S2-F13 satisfied screening read as rejection | High | farewell-wording doubt on an onboarding message | after an offer, onboarding mail retyped and the doubt cleared | unit |
| S2-F14 fragments as entities/roles | Med | no entity validation | employer/role cleanup (fragments, dangling parenthesis, team names) | unit, stored (Stripe title, "and the", HubSpot role) |
| S2-F15 search shows duplicates | Med | follows from grouping | fixed upstream by the above | stored |
| S2-F16 inflated active count | Med | follows from the above | account 2: 24 active -> 16 active | stored |
| Taxonomy (TMCF, SYNC) | - | no opportunity type | `Opportunity.kind` job/scholarship/mentorship, labelled when roleless | unit |

## Remaining, honestly
- Summer 2027 Allstate offer (S2-F02 second half): not present in stored data; needs a Gmail-side check or a re-sync with `DISCOVERY=sweep`.
- Sodexo role/outcome and other body-only facts: need ingestion re-reading (not implemented).
- No "accepted/completed" lifecycle state; an accepted offer stays at stage Offer.
- Cancelled-interview polarity, explicit-vs-relative deadlines (five tracked benchmark failures).
- Scholarship/mentorship are labelled but still counted in the pipeline totals.
- Course-program applications (e.g. a capstone course) are excluded, not typed.
- Second account never viewed in the browser; first-account counts unchanged (111 active / 64 closed).
