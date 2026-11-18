# Canonical domain resolution and first-party brand assets

Date: 2026-11-18. Builds on `docs/brand-coverage.md` and `docs/identity-graph.md`. No third-party logo API (Brandfetch, Logo.dev, or any) was used. Per-company tables are the person's own data and are not committed.

## Pipeline
`canonical employer (identity) -> canonical domain (lib/identity/domain.ts) -> bundled mark (curated, Simple Icons, Wikimedia pack) -> else one first-party fetch (lib/brand) -> local cache -> render`
Identity decides; a fetched asset is stored against an already-resolved company and domain and never feeds back into identity.

## 1. Canonical domain: sources, strongest first
| Source | What | Trust |
|---|---|---|
| learned | a domain the person confirmed for this company (their own "Looks right"/correction), per person, same poisoning guards as learned mappings | high |
| graph | the official website in public Wikidata (now ~70k organizations: companies, enterprises, startups, universities, nonprofits, banks, industry-tagged entities), following "recruits as parent" (AWS -> Amazon); prefers the domain whose label is the name | high |
| sender | a first-party sender domain from the person's own mail **metadata** (never message text): employer-class (not ATS, assessment, job board, scheduler, free mail), not serving 2+ companies in the mailbox, not a generic channel label, and whose name relates to the company (exact, or the organization plus a generic word like "recruiting"). **Must also pass the homepage check** (the page title/site name/heading must name the company) before any asset is used | medium |
A domain is never built by gluing a name to ".com". An unrelated sender domain, a platform, or a domain shared by two companies yields no domain (tested).

## 2. False employer entities (general, structural)
`lib/identity/classify.ts`: a name whose **head noun** is a program word (fellowship, fellows, forum, summit, conference, initiative, academy, program, challenge, hackathon, newsletter, corps, ...) names a program, not an employer; the organization behind it is what precedes the noun ("X Fellows" -> X, "X's Y Academy" -> X). In `applyIdentity`: a program run by a known organization resolves to that organization as *likely* with a plain reason; an unsponsored program stays as named but is never Known and gets no domain or fetched logo. A name the graph already knows as an employer ("Khan Academy") is never reclassified. At lookup, descriptors ("News", years, "Insurance Company") are stripped from the ends of a name (`names.ts`); ordinary-word names (Sage, Scale) get a mark only when the company is Known.

## 3. Local logo coverage
Full Simple Icons (3,287) and a popularity-ordered Wikimedia/Commons pack (351 public-domain/CC0 files). The crawl was stopped by design: Commons throttles to about 27 files/min, and ServiceNow and Allstate sit at ranks ~3,800-3,900 of the popularity list, so reaching them would take hours; selecting by the person's employers would tell Wikimedia their employers. They are left to the first-party step (ServiceNow's site answers 403 to anonymous clients, so it stays a monogram). The pack is resumable (`scripts/identity/build-logo-pack.py`, `wd-manifest.py`).

## 4. First-party fetch (approved)
When an employer is **Known**, has **no bundled mark**, and has a trustworthy canonical domain: one anonymous GET to that company's own homepage, find its best published icon, cache it locally, never fetch again (failures are cached 30 days). Triggered after a sync, in the background; off for the sample mailbox and with `BRAND_FETCH=off`.
- **What is sent:** only an HTTPS GET to the company's registrable domain (apex/www and same-domain assets), a fixed generic user agent, no cookies, no referrer. No name, role, email text, thread or account data. The company sees one request from the machine's IP.
- **What is refused:** non-HTTPS; hosts resolving to private/loopback/link-local ranges; every redirect is re-checked and a cross-domain redirect is refused (e.g. a rebrand redirect); assets on other domains (CDNs) are refused; size and time limits; SVG only if inert (no script, handlers, external references, foreign objects); dark-scheme CSS blocks are stripped so a mark is never white-on-white on the fixed light tile.
- **Quality:** SVG icon > web-app-manifest icon >= 192 px > apple-touch-icon >= 120 px > PNG icon >= 96 px. Favicons of 16-48 px, `.ico` files, mask icons (silhouettes) and non-square images are rejected: the monogram is better than a blurry mark.
- **Serving:** `/brands/cache/<file>` serves only files in the cache, with `nosniff` and a sandboxing CSP; path traversal returns 404. Rendering never triggers a fetch.
- **Cache:** `./.data/brands` (git-ignored, `BRAND_CACHE_DIR` to move it).

## 5. Measurement (real, non-sample development pipeline; aggregates)
| | account A (161 employers) | account B (26 employers) |
|---|---|---|
| canonical domain, before (graph only, earlier seed) | 64 (40%) | 12 (46%) |
| canonical domain, **after** | **113 (70%)** [graph 62, learned 28, sender 23] | **17 (65%)** |
| logo, before this milestone | 62 (39%) | 9 (35%) |
| from Simple Icons | 47 | 7 |
| from Wikimedia (pack so far) | 9 | 0 |
| curated | 6 | 2 |
| **from first-party sites** | **10** | **3** |
| logo, after | **72 (45%)** | **12 (46%)** |
| fallback (monogram) | 89 | 14 |
| incorrect domain (audited: every domain behind a displayed first-party logo, plus every bundled match, reviewed by eye) | 0 | 0 |
| incorrect logo | 0 | 0 |
Why the 89 fall back: 30 have no trustworthy domain; 5 are programs without a resolvable sponsor; 21 are not Known (never fetched); 33 were fetched and yielded nothing acceptable (bot walls and 403/429, cross-domain redirects, favicon-only sites, HTTP/2 resets). First-party fetch is a modest layer: of 45 domains tried on account A, 10 produced a logo-quality asset (22%), because the employers without a bundled mark are disproportionately small firms and bot-protected large sites. Correctness over coverage: nothing below the quality bar is stored.
Remaining levers: more Wikimedia depth (slow, throttled), better domain evidence for the 30 with none (identity: ATS-only senders carry no employer domain), and a hosted provider (not used; see `docs/brand-coverage.md`).
