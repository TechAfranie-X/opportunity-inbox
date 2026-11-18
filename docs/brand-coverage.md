# Company brand coverage: audit, source comparison, recommendation

Date: 2026-11-18. Product branch (`mvp`). Aggregates only: the per-company table is the person's own data and is NOT committed (`scripts/brand-coverage.ts` regenerates it locally).
No external logo service was contacted or activated.

## 1. The path, and where each logo fails
`canonical employer -> canonical domain -> logo source -> asset resolution -> rendering`
Measured on the **138 distinct employer names in the real (non-sample) pipeline** in the local product database:

| | logos | share |
|---|---|---|
| before this milestone (93 bundled glyphs + 10 curated) | 31 | 22% |
| now (full Simple Icons + name normalization + Wikidata pack, 248 files so far) | 44 | 32% |
| potential with the complete Wikidata logo set (not downloaded: Commons throttled the crawl; ~85% of files pass the licence filter) | ~64 (about 61 after licence) | ~45% |

Why the other 94 have no logo today (each classified by the code, not by hand):
| Failure | Count | Layer that fails | Fix |
|---|---|---|---|
| Wikidata has a logo, but it is not in the popularity-limited bundled pack | 20 | asset | local: extend the pack (resumable) |
| Domain known only from a first-party sender; no open-data logo | 22 | logo source | first-party icon (cached) or a provider |
| **No domain known** (not in Wikidata, no matching first-party sender) | 35 | **identity -> domain** | identity problem: more evidence for the company's domain; not a logo-source problem |
| Not a canonical employer: a program, event, newsletter or abbreviation ("X News", "X Fellowship", "Devcon 2026") | 16 | identity | canonicalization (partly fixed below: descriptors removed at lookup) |
| In open data but no public-domain logo | 1 | licence | first-party / provider |
Two bottlenecks, not one: **a third of the gap (35+16) is identity->domain, which no logo provider can fix**; a provider only helps the ~42 with a usable domain.
(Of the sample mailbox's 143 employers, most are fictional and correctly have no logo.)

Specific cases from the report: ServiceNow, Two Sigma and Allstate have Wikidata logos not yet in the pack; Bloomberg, Rippling and CodePath have only a first-party sender domain; Stanford now resolves (Wikidata, via "Stanford University" -> "Stanford"); "Ramp 2025" now resolves to Ramp; LinkedIn is not an employer in this pipeline (the identity layer treats it as a job board; a LinkedIn employer case needs relationship evidence and is a known edge).

## 2. What was fixed locally (shipped)
- **Name normalization at lookup** (`lib/identity/names.ts`): descriptors ("News", "Fellows", "Help Centre"), years, "(...)", leading "Volunteer at", legal suffixes and "Insurance Company"/"University" are removed from the ends of a name; nothing is ever added. Fixes "Ramp 2025", "CodePath News", "Arcesium LLC", "Stanford University".
- **The whole Simple Icons set (CC0), 3,287 brands**, as one SVG per brand with its official colour baked in (`public/brands/si`, 4.8 MB), indexed by normalized names (was 93). Rendered through the same tile; light brands on a dark tile.
- **Wikidata/Commons logo pack**, popularity-ordered, public-domain/CC0 files only (`public/brands/wd`, 1.2 MB so far), built by a resumable developer script. Not a crawl by anyone's mailbox.
- Resolver layering: curated asset -> Simple Icons -> Wikidata pack -> monogram. Identity still decides the logo, never the reverse.

## 3. Source comparison
Measured locally: Simple Icons, Wikidata/Commons, first-party. Not measured (would send our domains to a third party): Logo.dev, Brandfetch; their rows are from their published terms.
| Source | Real-set coverage | Correct-company | Colour / dark-light | Latency | Caching | Licence / terms | Cost | Privacy leak | Reliability |
|---|---|---|---|---|---|---|---|---|---|
| Simple Icons (CC0, bundled) | 35/138 (25%, incl. normalization) | exact name match | official colour; mono brands black | 0 (bundled) | n/a | CC0 art; trademarks remain | free | none | offline |
| Wikidata + Commons (bundled pack) | up to ~61/138 (~45%) overlapping Simple Icons: ~+20 net | by Wikidata identity | mostly colour SVG/PNG; some white-on-transparent marks need a dark tile (not detected) | 0 (bundled) | n/a | PD/CC0 files only (licence checked per file) | free | none at run time | offline |
| First-party site icons (the company's own favicon/apple-touch-icon) | on a random public-domain sample: 26/40 (65%) found one; 18/40 good (SVG or 180 px touch icon), 8/40 only a 16-48 px .ico | exact (own domain) | whatever the site publishes; often a square app-icon | ~2 s per site, once | cache forever locally | the company's own public asset | free | the company's site sees one GET from the machine's IP | fails on bot walls and SPAs |
| Brandfetch Logo API | not measured | domain-keyed | full-colour, light/dark variants | CDN | **hotlink only: the free Logo API may not be stored; caching needs a custom plan** | no attribution; free up to ~500k-1M requests/month (their pages disagree); client ID required; programmatic access not permitted | free tier, then paid | **every render sends the domain, IP and referrer to Brandfetch, on every page view** | requires network |
| Logo.dev | not measured | domain-keyed | colour | CDN | limited; reasonable caching only | **free tier requires a visible attribution link for commercial use**; token; 500K requests/month free | free tier, paid plans remove attribution | domain (and IP) per render | requires network |
Sources: Brandfetch (brandfetch.com/developers/logo-api, docs.brandfetch.com/logo-api/guidelines), Logo.dev (logo.dev/pricing, docs.logo.dev/platform/fair-use). Verify current terms before relying on any number.

## 4. Recommended architecture (layered, local first)
1. **Identity first** (done): canonical employer, with descriptor stripping.
2. **Bundled packs** (done): curated, Simple Icons (3.3k), Wikidata/Commons (popularity-ordered, extendable offline by a developer, e.g. top 3,000 = ~6 MB).
3. **Canonical domain** (partly done): graph domain (Wikidata), else a first-party sender domain whose label matches the company (metadata only, never body text), else learned from the person's confirmations. This layer is where 35 of 138 fail: fix identity evidence first.
4. **First-party icon, fetched once and cached locally (needs your approval)**: for a company with a verified domain and no bundled logo, fetch the company's own icon once, store it in the app's data directory, and never fetch again. About 65% success, one GET per company to the company's own site. Expected gain on the real set: roughly +25 (of the 39-42 with a domain).
5. **A hosted provider only as a last fallback, and only if its measured advantage is material.** The domain ceiling caps any provider: ~42 real employers have a domain and no logo today, so a provider could add at most ~42 minus what first-party already fills (~10-15 more, ~7-10% of the pipeline) at the price of sending a domain to a third party, with hotlinking (Brandfetch) or attribution (Logo.dev free). **Not recommended now.** If wanted later: Logo.dev paid (no attribution; confirm caching terms) with a one-time cache, domains only.

Expected real-set coverage: now 32%; with the full Wikidata set ~45%; with first-party cached icons ~60-65% (of the ~122 genuine employers, ~70%); with a provider on top ~70% (of genuine employers ~80%). The rest needs better identity->domain, not logos.

## 5. What would leave the machine, per option (nothing is activated)
- **Extending the pack (local, now):** nothing from the product. A developer downloads public Commons files chosen by popularity.
- **First-party cached icons:** the company's registrable domain, as an HTTPS GET to that company's own homepage, once per company, from the user's machine (IP visible to that company). No name, no email text, no account data. Needs approval.
- **Brandfetch / Logo.dev:** the company domain plus the user's IP and page referrer to the provider on each logo render (Brandfetch may not be cached on the free plan), plus an API key/client ID in the page. Needs approval and, for Logo.dev's free tier, an attribution link. Cost: free tiers exist; paid plans are needed to remove attribution or to cache.

## 6. Reproduce
`scripts/brand-coverage.ts <companies.tsv> [sender-domains.tsv]` (FULL=1 for the per-company table; WD_DIR for the raw Wikidata slices); `scripts/identity/build-icon-pack.py`, `build-logo-pack.py` (resumable), `wd-manifest.py`, `fetch-brand-assets.py`.
