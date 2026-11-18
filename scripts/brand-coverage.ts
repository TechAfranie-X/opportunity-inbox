/**
 * Logo coverage report for a list of canonical employer names (a TSV: company<TAB>events, plus an optional TSV of company<TAB>sender domain<TAB>n used
 * ONLY to derive a first-party domain candidate: a metadata domain whose label matches the company name; never message text). Prints
 *   company | canonical domain | logo before | logo now | source | failure reason
 * Local only: nothing is fetched, nothing is committed (the lists are the person's own data).
 *   node ... scripts/brand-coverage.ts <companies.tsv> [sender-domains.tsv]
 */
import { readdirSync, readFileSync } from "node:fs";
import { LOGOS } from "../lib/identity/logos.ts";
import { BRAND_ASSETS } from "../lib/identity/brand-assets.ts";
import { orgsNamed } from "../lib/identity/graph.ts";
import { lookupKeys } from "../lib/identity/names.ts";
import { brandFor, normalizeCompany } from "../lib/identity/resolve.ts";

const [companiesFile, domainsFile] = process.argv.slice(2);
// WD_DIR: the raw public Wikidata slices (JSON). Marks which companies HAVE a Wikidata logo even when the bundled pack (popularity-limited) lacks the file yet.
const wdAll = new Set<string>();
if (process.env.WD_DIR) {
  const LEGAL = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|holdings?|group|technologies|technology|the)\b\.?/gi;
  for (const f of readdirSync(process.env.WD_DIR).filter((x) => x.endsWith(".json"))) {
    for (const b of JSON.parse(readFileSync(`${process.env.WD_DIR}/${f}`, "utf8")).results.bindings) {
      const n: string = b.cLabel.value;
      if (/^Q\d+$/.test(n)) continue;
      wdAll.add(n.replace(LEGAL, " ").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "") || n.toLowerCase().replace(/[^a-z0-9]/g, ""));
      wdAll.add(n.replace(/\b(university|college)\b/gi, " ").replace(LEGAL, " ").toLowerCase().replace(/[^a-z0-9]/g, ""));
    }
  }
}
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const companies = readFileSync(companiesFile, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")).map(([c, n]) => ({ company: c, events: Number(n) || 1 }));
const derived = new Map<string, string>();
if (domainsFile) {
  for (const l of readFileSync(domainsFile, "utf8").split("\n").filter(Boolean)) {
    const [c, d] = l.split("\t");
    const label = flat(d.split(".").slice(-2, -1)[0] ?? "");
    const k = lookupKeys(c)[0] ?? flat(c);
    if (label.length >= 3 && (label.includes(k) || k.includes(label)) && !derived.has(c)) derived.set(c, d.split(".").slice(-2).join("."));
  }
}
const before = (c: string) => { const k = normalizeCompany(c).replace(/ /g, ""); return Object.hasOwn(LOGOS, k) || Object.hasOwn(BRAND_ASSETS, k); };
const PROGRAM = /\b(fellowship|fellows|forum|devcon|summit|conference|week|program|initiative|fund|scholars?|academy|challenge|hackathon|newsletter)\b/i;
const rows = companies.map(({ company, events }) => {
  const b = brandFor(company);
  const org = orgsNamed(company).find((o) => o.kind === "employer");
  const domain = org?.domains[0] ?? derived.get(company) ?? "";
  const domainFrom = org?.domains[0] ? "graph" : derived.get(company) ? "sender" : "";
  const inWdNotPack = !b && lookupKeys(company).some((k) => wdAll.has(k));
  let reason = "";
  if (inWdNotPack) reason = "Wikidata has a logo; not yet in the popularity-limited bundled pack";
  else if (!b) reason = PROGRAM.test(company) || flat(company).length <= 3 ? "not a canonical employer (program/event/abbreviation)" : !domain ? "no domain known (not in open data, no first-party sender domain)" : domainFrom === "sender" ? "domain known only from a first-party sender; no open-data logo" : "in open data, but no public-domain logo";
  return { company, events, domain: domain ? `${domain} (${domainFrom})` : "", before: before(company) ? "yes" : "no", now: b ? "yes" : "no", source: b?.source ?? "", reason };
});
const n = rows.length, yes = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
console.log(`companies ${n} | logo before ${yes((r) => r.before === "yes")} | logo now ${yes((r) => r.now === "yes")} | by source: ${["curated", "simple-icons", "wikidata"].map((s) => `${s} ${yes((r) => r.source === s)}`).join(", ")}`);
const reasons = new Map<string, number>();
for (const r of rows) if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
console.log("still without a logo, by reason:", [...reasons].map(([k, v]) => `${v} x ${k}`).join(" | "));
console.log(`potential with the full Wikidata logo set (before licence filtering, ~85% pass): ${yes((r) => r.now === "yes") + yes((r) => r.reason.startsWith("Wikidata has a logo"))}`);
const withDomain = rows.filter((r) => r.now === "no" && r.domain && !r.reason.startsWith("not a canonical")).length;
console.log(`without a logo but with a usable domain (candidates for a first-party or hosted source): ${withDomain}`);
if (process.env.FULL) for (const r of rows.sort((a, b) => b.events - a.events)) console.log([r.company, r.domain || "-", r.before, r.now, r.source || "-", r.reason || "-"].join(" | "));
