# Company Identity Graph and Employer Resolution

Date: 2026-11-18. Product branch (`mvp`) only. Frozen evaluation candidate untouched (guard tests pass). No paid service, no network at run time, no private text sent anywhere.
Builds on `docs/semantic-intelligence.md`.

## 1. Architecture
```
email + context
  -> organization candidates (rule evidence, semantic reading, thread, known applications, learned mappings)
  -> canonical identity (identity graph: names, aliases, domains, kinds, parents)   lib/identity/graph.ts
  -> relationship reasoning (employer vs agency / ATS / assessment / scheduler / job board / recruiter / team)   lib/identity/resolver.ts
  -> evidence verification (semantic claims must be quoted; vendors cannot be employers)   lib/semantic/reading.ts
  -> reconciliation into the event   lib/identity/reconcile.ts
  -> known | likely | review | unknown  -> UI (monogram / public mark by canonical name)
```
The graph answers "what entity does this name or domain refer to, and what kind of organization is it?". The semantic reader answers "what is this organization's relationship to this application?". Deterministic verification answers "is there enough grounded evidence?". The graph is a *prior*, never ground truth.

### Identity record (simple on purpose)
`{ id, name, kind (employer | agency | ats | assessment | scheduler | job_board), domains[], parent?, recruitsAs (self | parent), ambiguous, source }`.
Aliases are generated (normalized name forms, legal suffixes and department words removed: "Everpure Recruiting" -> "Everpure", "Meta University Recruiting" -> "Meta"), not enumerated. `recruitsAs: parent` says a brand recruits under its parent (AWS and Amazon Web Services resolve to Amazon, which is the product's company model: one employer per recruiting umbrella; LinkedIn, GitHub and similar stay themselves). Logo is derived from the canonical name, not stored.

### Layers
1. **Public Wikidata (CC0)**: 16,844 companies with official websites and parents, built once by `scripts/identity/build-seed.py` from four fixed queries (public companies, large businesses, companies founded since 1985, software companies). Bundled (737 KB, server-side only). The product never calls Wikidata.
2. **Curated**: ATS, assessment, scheduler and job-board vendors, staffing agencies, brands that recruit through a parent (about 70 records; public facts).
3. **Brand marks**: 93 public marks (simple-icons, CC0) also name well-known employers.
4. **The person's own confirmations**, learned locally (section 6).
Coverage is partial by design: **10 of 26 sampled real employer names (38%) were in the 16.8k-company seed** (Lyft, Neuralink, Notion, Plaid, Jane Street, Scale AI, Toast, Anduril, Waymo, Brex, Figma, Robinhood, Roblox and others were not). A name the graph does not know is not rejected; it simply gets no help from the prior and must earn trust from the message.

## 2. Public/open data sources evaluated
| Source | Gives | Decision |
|---|---|---|
| **Wikidata (CC0)** | names, official domains, parent organizations | **Accepted** (queried and measured; see coverage above). Best open source of domain ownership and parents |
| **simple-icons (CC0)** | brand names and glyphs | **Accepted** (already the logo layer) |
| GLEIF LEI (CC0) | legal names, full parent/child hierarchy | Not used: no domains, hundreds of MB, legal entities rather than recruiting brands. Revisit for parent links only. (Assessed from documentation, not downloaded.) |
| SEC EDGAR company list (public domain) | names and tickers of US public companies | Not used: public companies only, no domains, already mostly in Wikidata |
| OpenCorporates | company registry | Rejected: API is paid for real use; share-alike data licence |
| Clearbit-style logo/autocomplete APIs | logos and domains by name | Rejected: sends company names to a third party, free tier discontinued, and a logo found by name would decide identity (backwards) |
| Tranco / Majestic top-domain lists | popular domains | Not used: domains without names or relationships; research licences |
| Common Crawl | web text | Not practical: size, and no curated identity |
| Public Suffix List | registrable domains | Not added as a dependency: a small rule (second-level suffixes) covers the need |
Static lists cannot be the answer: the measured coverage of even a 17k-company seed is 38% of real employers seen in mail, so the resolver treats the graph as one signal among several.

## 3. Employer vs agency / vendor
- **Kinds rule candidates out.** A name that is, or merely extends ("HackerRank Tests", "12twenty for Employers"), an ATS, assessment platform, scheduler, job board or staffing firm is recorded as an *intermediary*, never an employer. Staffing and search firms the graph has never heard of are caught by what they say they are ("staffing", "executive search").
- **People are recruiters, not companies**: "Fry, Alan R", "Dana Reyes at Robert Half" (the organization after "at" is judged separately).
- **Generic words are not organizations**: "Opportunity", "Recruiter", "Candidate Care", and channel domains ("jobs-notify", "example-mail").
- **Sender domains serving two or more confident employers in the same mailbox are vendors** (rule I5 of the rule reader, extended).
- **A team or function around a name is stripped, and recorded**: "Everpure Recruiting" -> employer candidate Everpure, team "Everpure Recruiting".
- **An agency acting for a client**: the client becomes the employer only with a verified relationship from the semantic reader; the agency is recorded as intermediary. Without a reading, nothing is invented.
- **Ordinary-word names** (Scale, Toast, X, Ramp, 3-letter names) need two independent classes of evidence to be Known; very short names with one class stay Unknown.
- **A name that extends a vendor's** ("Handshake AI") is never Known on its own.

## 4. Trust ladder (calibrated, not "everything semantic needs review")
Evidence is combined by **independent class** (owner = sender domain, assertion = display name and subject when a vendor stamps both, text = body, tenant, thread, known application, learned mapping, relationship = verified semantic claim). Two readers agreeing on the same prose earn a small bonus, not a full vote.
| State | When | Written as |
|---|---|---|
| **Known** | score >= 0.8 with two independent classes, or one decisive class (own-domain ownership in the graph, thread continuity, ATS tenant, your earlier confirmation, a verified relationship), no ordinary-word ambiguity, no conflict | company, confidence 0.8; no review item |
| **Likely** | score >= 0.4 | company, confidence 0.5, "X appears to be the employer; please confirm", names the intermediary |
| **Review** | two plausible employers within 0.25 | leading candidate at 0.4 naming both |
| **Unknown** | below 0.4 | no company; a rules guess is withdrawn only when its sole support was a channel |
A confident rules reading is never overturned silently: disagreement is flagged, and a confident rules answer that is a vendor, agency or generic word is vetoed (Robert Half, Kforce, "Interview", "Recruiter").

## 5. Results (aggregates only; `scripts/identity-eval.ts`)
**Real development mailbox** (3 development datasets, 1,000 messages, 77 recruiting; read-only local copy; cached semantic outputs for 484 messages). These are *regression* numbers: the rule reader was fitted to this data.
| | rules + reliability (before) | + identity layer | + cached semantic + identity |
|---|---|---|---|
| employer right (of 73 shown with a named employer) | 60 (82%) | 61 (84%) | 62 (85%) |
| wrong employer | 3 | 4 (two are acronyms of the right answer: "Usmc") | 4 |
| **silent wrong (shown as Known)** | **1** | **0** | **0** |
| known / likely / review / unknown | 44 / 19 / 0 / 10 | 51 / 8 / 6 / 8 | 53 / 7 / 6 / 7 |
| events with something to confirm | 32 | 32 | 33 |
Interpretation: on a mailbox the rules already know, the layer mostly *calibrates*: it moved 7 guesses from likely to known where independent evidence converged (own-domain ownership, vendor-extension names demoted, vendors vetoed) and made the one silent error visible. Resolution rate barely moves because there was little left to resolve.

**Fresh synthetic sets** (no real mail; set A written for the previous milestone, holdout written for this one before the resolver ran on it; semantic reader = Haiku-class in-session worker, blind to truth):
| | rules (before) | + identity | semantic (prev.) | semantic + identity |
|---|---|---|---|---|
| set A: employer right (30 named) | 6/22 shown | 6/22 | 29/30 | **30/30** |
| set A: wrong / invented where none | 3 / 3 | **0 / 0** | 1 / 2 | **0 / 0** |
| holdout: employer right (23 named) | 14/20 | 14/20 | 21/23 | **22/23** |
| holdout: wrong / invented where none | 2 / 3 | **0 / 0** | 1 / 3 | **0 / 1** (Scale, shown as Likely) |
| holdout: silent wrong (Known) | 2 | 0 | 1 | 0 |
| holdout: states known/likely/review/unknown | 9/10/0/6 | 10/3/1/11 | 14/11/0/4 | 14/7/2/6 |
Agency/vendor confusion (Robert Half, Kforce, HackerRank Tests, Interview, Recruiter, Candidate Care, "Dana Reyes at Robert Half", TalentBridge Staffing): all caught. The Everpure shape resolves to *Likely Everpure* with HackerRank recorded as the assessment platform; with the relationship in the body it becomes Known.
**Honesty:** the holdout was run once, then 4 general fixes were made after seeing it (person-at-organization parsing, withdrawal of channel-derived guesses, generic department words, vendor-extension names) and re-scored; so it is no longer a clean holdout. Synthetic, single-run, single (small) semantic model, same authors for cases and resolver. Not an accuracy claim. Wrong-employer rate is the number to watch: 0 silent-wrong on both synthetic sets and on development data after the fixes.

## 6. Corrections improve future resolution
`lib/identity/learned.ts` derives mappings at read time from events the person corrected or confirmed (no new storage, no schema change): *sender domain -> company* and *sender display name -> company*, per person only. Poisoning guards: nothing is learned from a shared sender (ATS, assessment, job board, scheduler, free mail, or a domain the graph attributes to another organization); a domain or name confirmed as two different companies is dropped; a person's name is never a key; a mapping is high-weight evidence (0.92), not a verdict, so a conflicting strong signal still goes to review. Confirming "Quillhaven Recruiting -> Quillhaven" makes the next message from that domain Known; it changes nothing for other senders or other people.

## 7. Logos
Identity determines logo, never the reverse: the logo is looked up by the **canonical resolved name** and only for Known or Likely companies (`EntityMark`). AWS and "Amazon Web Services Recruiting" resolve to Amazon and show the Amazon mark; Everpure (no public mark) keeps the monogram; Unknown stays the dashed placeholder. No logo is searched for, fetched, or used to choose a company.

## 8. Remaining failure modes
- Coverage: unlisted companies get no prior; domain-label guesses ("Quillhaven" from quillhaven.io) rely on the message to confirm.
- Acronyms and abbreviations ("USMC" vs "U.S. Marine Corps") are not yet folded into one entity (the strict matcher counts them wrong).
- A university or lab domain sending for an affiliated lab (Stanford/SLAC) resolves to the sender's organization (Likely) rather than the lab; parent links are used for conflict, not for choosing.
- Rules-confident wrong readings that are not vendors, agencies or generic words still stand (flagged only on disagreement).
- Agency-for-client needs the semantic reader; with it off, such mail stays Unknown.
- Everpure-style mail with the name only in the vendor's template is Likely until a second independent signal appears (body relationship, thread, your confirmation).
