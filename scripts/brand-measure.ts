/**
 * Canonical-domain and first-party brand measurement on the REAL (non-sample) local pipeline. Local only; prints aggregates and, with FULL=1, the
 * per-company table (the person's own data: never commit it). With FETCH=1 it performs the first-party fetches (company domains only).
 *   node --env-file=.env.local ... scripts/brand-measure.ts <user sub> [FETCH=1] [FULL=1]
 */
import { ensureFirstPartyBrands } from "../lib/brand/ensure.ts";
import { readIndex } from "../lib/brand/cache.ts";
import { domainEvidence, learnedCompanyDomains, resolveDomain } from "../lib/identity/domain.ts";
import { orgsNamed } from "../lib/identity/graph.ts";
import { learnedMappings } from "../lib/identity/learned.ts";
import { lookupKeys } from "../lib/identity/names.ts";
import { brandFor } from "../lib/identity/resolve.ts";
import { entityState } from "../lib/recruiting/presentation.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";

const sub = process.argv[2];
const ws = await loadWorkspace(sub);
const opps = ws.opportunities.filter((o) => o.company && o.company !== "Unknown company");
const events = opps.flatMap((o) => o.events);
const evidence = domainEvidence(events);
const learned = learnedCompanyDomains(learnedMappings(events));
const graphOnly = (c: string) => lookupKeys(c).some((k) => orgsNamed(k).some((o) => o.kind === "employer" && o.domains.length > 0));
const rows = opps.map((o) => ({ o, state: entityState(o), domain: resolveDomain(o.company, { evidence, learnedCompanyDomains: learned }), bundled: brandFor(o.company) }));
const n = rows.length;
const pct = (a: number) => `${a}/${n} (${Math.round((100 * a) / n)}%)`;
console.log(`employers (distinct opportunities) ${n}; known ${rows.filter((r) => r.state === "known").length}, likely ${rows.filter((r) => r.state === "likely").length}`);
console.log(`canonical domain: before (graph only) ${pct(rows.filter((r) => graphOnly(r.o.company)).length)} | after ${pct(rows.filter((r) => r.domain).length)}  [graph ${rows.filter((r) => r.domain?.source === "graph").length}, learned ${rows.filter((r) => r.domain?.source === "learned").length}, sender ${rows.filter((r) => r.domain?.source === "sender").length}]`);
console.log(`logo before first-party: ${pct(rows.filter((r) => r.bundled).length)}  [curated ${rows.filter((r) => r.bundled?.source === "curated").length}, simple-icons ${rows.filter((r) => r.bundled?.source === "simple-icons").length}, wikimedia ${rows.filter((r) => r.bundled?.source === "wikidata").length}]`);
const dry = await ensureFirstPartyBrands(opps, { dryRun: !process.env.FETCH, max: 200, budgetMs: 240_000 });
console.log("ensure:", JSON.stringify({ considered: dry.considered, queued: dry.queued, fetched: dry.fetched, cachedOk: dry.cachedOk, none: dry.none, skipped: dry.skipped }));
if (process.env.FETCH) {
  const idx = readIndex();
  const ok = rows.filter((r) => r.domain && idx.domains[r.domain.domain]?.status === "ok" && !r.bundled).length;
  const none = rows.filter((r) => r.domain && idx.domains[r.domain.domain]?.status === "none" && !r.bundled).length;
  console.log(`first-party: logos ${ok}; no acceptable asset ${none}; logo after = ${pct(rows.filter((r) => r.bundled).length + ok)}; fallback (monogram) = ${n - rows.filter((r) => r.bundled).length - ok}`);
}
if (process.env.FULL) {
  const idx = readIndex();
  for (const r of rows.sort((a, b) => b.o.events.length - a.o.events.length)) {
    const e = r.domain ? idx.domains[r.domain.domain] : undefined;
    console.log([r.o.company, r.state, r.domain ? `${r.domain.domain} (${r.domain.source})` : "-", r.bundled?.source ?? (e?.status === "ok" ? `first-party:${e.from}:${e.kind}` : e ? `none:${e.reason}` : "-")].join(" | "));
  }
}
process.exit(0);
