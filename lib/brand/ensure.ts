import { classifyOrgName } from "../identity/classify.ts";
import { domainEvidence, learnedCompanyDomains, resolveDomain } from "../identity/domain.ts";
import { flat, orgsNamed } from "../identity/graph.ts";
import { learnedMappings } from "../identity/learned.ts";
import { lookupKeys } from "../identity/names.ts";
import { brandFor } from "../identity/resolve.ts";
import { entityState } from "../recruiting/presentation.ts";
import type { Opportunity } from "../recruiting/types.ts";
import { readIndex, shouldFetch, writeAsset, writeIndex } from "./cache.ts";
import { fetchFirstParty, type Fetched } from "./first-party.ts";

export type EnsureResult = { considered: number; queued: number; fetched: number; cachedOk: number; none: number; skipped: Record<string, number>; domains: Array<{ company: string; domain: string; source: string }> };

/**
 * Identity decides, then (maybe) one request. For each employer that is KNOWN (not merely likely), has no bundled mark, and has a canonical domain with
 * independent support (domain.ts), fetch that company's own public icon once and cache it. Likely, unknown and program-without-sponsor companies are never
 * fetched; neither are domains already cached or recently failed. Only the domain is contacted (see first-party.ts). The result never changes any company.
 */
export async function ensureFirstPartyBrands(opps: Opportunity[], opts: { max?: number; budgetMs?: number; fetcher?: typeof fetchFirstParty; dryRun?: boolean } = {}): Promise<EnsureResult> {
  const max = opts.max ?? 12, budget = opts.budgetMs ?? 40_000, fetcher = opts.fetcher ?? fetchFirstParty;
  const events = opps.flatMap((o) => o.events);
  const evidence = domainEvidence(events);
  const learnedDomains = learnedCompanyDomains(learnedMappings(events));
  const index = readIndex();
  const out: EnsureResult = { considered: 0, queued: 0, fetched: 0, cachedOk: 0, none: 0, skipped: {}, domains: [] };
  const skip = (why: string) => { out.skipped[why] = (out.skipped[why] ?? 0) + 1; };
  const queue = new Map<string, { domain: string; source: "learned" | "graph" | "sender"; keys: string[]; needsPageCheck: boolean; companies: string[] }>();

  for (const o of opps) {
    out.considered++;
    const company = o.company;
    if (!company || company === "Unknown company") { skip("no company"); continue; }
    if (brandFor(company)) { skip("bundled mark exists"); continue; }
    if (entityState(o) !== "known") { skip("not a known employer"); continue; }
    const cls = lookupKeys(company).some((k) => orgsNamed(k).some((o) => o.kind === "employer")) ? { kind: "employer" as const, sponsor: null } : classifyOrgName(company);
    const key = lookupKeys(company)[0] ?? flat(company);
    const d = resolveDomain(company, { evidence, learnedCompanyDomains: learnedDomains });
    if (!d) { skip(cls.kind === "program" ? "program without a resolvable sponsor" : "no trustworthy domain"); continue; }
    out.domains.push({ company, domain: d.domain, source: d.source });
    index.companies[key] = d.domain;
    if (!shouldFetch(index.domains[d.domain])) { if (index.domains[d.domain]?.status === "ok") out.cachedOk++; else skip("recently failed"); continue; }
    const q = queue.get(d.domain) ?? { domain: d.domain, source: d.source, keys: [], needsPageCheck: d.needsPageCheck, companies: [] };
    for (const k of lookupKeys(cls.kind === "program" && cls.sponsor ? cls.sponsor : company)) if (!q.keys.includes(k)) q.keys.push(k);
    q.companies.push(company);
    queue.set(d.domain, q);
  }
  out.queued = queue.size;
  if (opts.dryRun) return out;

  const started = Date.now();
  const todo = [...queue.values()].slice(0, max);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < todo.length && Date.now() - started < budget) {
      const q = todo[next++];
      let r: Fetched;
      try { r = await fetcher(q.domain, { source: q.source, companyKeys: q.keys, needsPageCheck: q.needsPageCheck }); } catch { continue; }
      if (r.entry.status === "ok" && r.data !== undefined && r.file) { writeAsset(r.file, typeof r.data === "string" ? r.data : r.data); out.fetched++; } else out.none++;
      index.domains[q.domain] = r.entry;
    }
  }));
  writeIndex(index);
  return out;
}
