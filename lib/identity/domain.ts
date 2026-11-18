import { parseSender } from "../opportunities/normalize.ts";
import { classifySender } from "../recruiting/entity/vendors.ts";
import { classifyOrgName } from "./classify.ts";
import { canonicalOrg, flat, orgsAtDomain, orgsNamed, registrable } from "./graph.ts";
import type { LearnedMap } from "./learned.ts";
import { lookupKeys } from "./names.ts";
import { isGenericLabel } from "./resolver.ts";

/**
 * Canonical domain resolution: "which website is this employer's own?". A domain is attached to an employer only with independent support; it is
 * NEVER built by gluing a name to ".com". Sources, strongest first:
 *   learned   a domain the person confirmed for this company (their own correction or "Looks right")
 *   graph     the official website recorded for the organization in public Wikidata, following "recruits as parent" (AWS -> Amazon)
 *   sender    a first-party sender domain from the person's own mail METADATA (never text): an employer-class domain (not an ATS, assessment platform,
 *             job board, scheduler, free mail, or a domain that serves other companies) whose name relates to the company's
 * A program or event name resolves through its sponsor only when the sponsor itself resolves. Anything else returns null (a monogram, no fetch).
 */
export type DomainSource = "learned" | "graph" | "sender";
export type ResolvedDomain = { domain: string; source: DomainSource; /** sender-derived domains must also pass the page check before any asset is used */ needsPageCheck: boolean };
/** company key -> sender domain -> number of messages. Built from the person's own events (domain metadata only). */
export type DomainEvidence = Map<string, Map<string, number>>;

export function domainEvidence(events: Array<{ company: string | null; senderDomain: string; outbound?: boolean }>): { byCompany: DomainEvidence; shared: Set<string> } {
  const byCompany: DomainEvidence = new Map();
  const companiesOf = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.outbound || !e.company || !e.senderDomain) continue;
    const dom = registrable(e.senderDomain);
    const key = lookupKeys(e.company)[0] ?? flat(e.company);
    const m = byCompany.get(key) ?? byCompany.set(key, new Map()).get(key)!;
    m.set(dom, (m.get(dom) ?? 0) + 1);
    (companiesOf.get(dom) ?? companiesOf.set(dom, new Set()).get(dom)!).add(key);
  }
  // a domain that serves two or more different companies in this mailbox is a platform, not an employer
  return { byCompany, shared: new Set([...companiesOf].filter(([, v]) => v.size >= 2).map(([d]) => d)) };
}

const labelOf = (domain: string) => flat(domain.split(".").slice(0, -1).pop() ?? domain);
const GENERIC_PARTS = /(recruiting|recruitment|careers?|jobs?|talent|hiring|people|mail|email|notify|news|team|hr|campus|university|early|students?)/g;
const stripGeneric = (label: string) => label.replace(GENERIC_PARTS, "");

function relatedLabel(label: string, key: string): "exact" | "contains" | null {
  if (!label || !key) return null;
  if (label === key) return "exact";
  const bare = stripGeneric(label);
  if (bare === key) return "contains"; // "drwrecruiting" for "drw": the organization plus a generic word
  if (key.length >= 4 && label.length >= 4 && (label.startsWith(key) || key.startsWith(label)) && Math.abs(label.length - key.length) <= 6) return "contains";
  return null;
}

export function resolveDomain(company: string, ctx: { evidence?: { byCompany: DomainEvidence; shared: Set<string> }; learnedCompanyDomains?: Map<string, string> }): ResolvedDomain | null {
  const knownOrg = lookupKeys(company).some((k) => orgsNamed(k).some((o) => o.kind === "employer"));
  const cls = knownOrg ? { kind: "employer" as const, sponsor: null } : classifyOrgName(company);
  const target = cls.kind === "program" ? cls.sponsor : company;
  if (!target) return null;
  const keys = lookupKeys(target);
  if (keys.length === 0) return null;

  for (const k of keys) {
    const learned = ctx.learnedCompanyDomains?.get(k);
    if (learned) return { domain: learned, source: "learned", needsPageCheck: false };
  }
  for (const k of keys) {
    const org = orgsNamed(k).find((o) => o.kind === "employer" && o.domains.length > 0) ?? orgsNamed(k).find((o) => o.kind === "employer");
    if (!org) continue;
    const canon = canonicalOrg(org);
    const domains = canon.domains.length > 0 ? canon.domains : org.domains;
    if (domains.length > 0) {
      // the domain whose label is the name wins ("meta.com" over "about.meta.com"); otherwise the first official one
      const best = domains.find((d) => labelOf(d) === flat(canon.name)) ?? domains[0];
      return { domain: registrable(best), source: "graph", needsPageCheck: false };
    }
  }
  const seen = keys.map((k) => ctx.evidence?.byCompany.get(k)).find((m) => m && m.size > 0);
  if (seen) {
    const ranked = [...seen].sort((a, b) => b[1] - a[1]);
    for (const [dom, n] of ranked) {
      if (ctx.evidence!.shared.has(dom) || isGenericLabel(labelOf(dom))) continue;
      if (classifySender(dom) !== "employer" || orgsAtDomain(dom).some((o) => o.kind !== "employer")) continue;
      const rel = relatedLabel(labelOf(dom), keys[0]) ?? keys.slice(1).map((k) => relatedLabel(labelOf(dom), k)).find(Boolean) ?? null;
      if (rel === "exact" || (rel === "contains" && n >= 1)) return { domain: dom, source: "sender", needsPageCheck: true };
    }
  }
  return null;
}

/** A learned company -> domain map from the person's own confirmed events (company key -> registrable domain), same poisoning guards as learnedMappings. */
export function learnedCompanyDomains(learned: LearnedMap, companyOfDomain: Map<string, string> = new Map()): Map<string, string> {
  const out = new Map<string, string>();
  for (const [domain, company] of learned.byDomain) out.set(lookupKeys(company)[0] ?? flat(company), domain);
  for (const [domain, company] of companyOfDomain) out.set(lookupKeys(company)[0] ?? flat(company), domain);
  return out;
}

export const registrableOf = (from: string) => registrable(parseSender(from).domain);
