import { BRAND_ASSETS } from "./brand-assets.ts";
import { LOGOS } from "./logos.ts";

/**
 * Company identity as a presentation asset. Input: the already-resolved employer name (never email text). Output: a bundled public mark, or null.
 * Rules: exact match after normalisation only (no fuzzy guessing); applicant-tracking and job-board vendors are never an employer; no mark is
 * ever invented. Pure and local: no network.
 */

/** Vendors that send recruiting mail on an employer's behalf. Their marks must never stand in for the employer. */
export const VENDOR_KEYS = new Set([
  "greenhouse", "lever", "workday", "myworkdayjobs", "ashby", "ashbyhq", "smartrecruiters", "icims", "taleo", "jobvite", "bamboohr", "workable",
  "hackerrank", "codesignal", "codility", "handshake", "linkedin", "indeed", "glassdoor", "ziprecruiter", "hirevue", "oracle", "teamtailor",
  "rippling", "gem", "eightfold", "phenom", "paylocity", "paycom", "recruitee", "breezy", "pinpoint", "wellfound", "angellist", "dover",
]);

const SUFFIXES = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|technologies|technology|holdings|group)\b/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Explicit alternates that normalise differently from the registry key. */
const ALIASES: Record<string, string> = {
  "alphabet": "google",
  "google cloud": "google",
  "amazon web services": "amazon",
  "aws": "amazon",
  "meta platforms": "meta",
  "facebook": "meta",
  "paypal holdings": "paypal",
  "epic games": "epicgames",
  "doordash": "doordash",
  "door dash": "doordash",
  "cockroach labs": "cockroachlabs",
  "new relic": "newrelic",
  "goldman sachs": "goldmansachs",
  "wells fargo": "wellsfargo",
  "bank of america": "bankofamerica",
  "american express": "americanexpress",
  "amex": "americanexpress",
  "mongo db": "mongodb",
  "git hub": "github",
  "git lab": "gitlab",
  "digital ocean": "digitalocean",
  "open ai": "openai",
  "space x": "spacex",
  "bytedance": "bytedance",
  "tik tok": "tiktok",
  "hub spot": "hubspot",
  "pager duty": "pagerduty",
  "data stax": "datastax",
  "hashi corp": "hashicorp",
};

export type Brand =
  | { kind: "image"; key: string; name: string; src: string; fit: "bleed" | "inset" }
  | { kind: "glyph"; key: string; name: string; path: string; color: string };

const ASSET_ALIAS = new Map<string, string>();
for (const [k, a] of Object.entries(BRAND_ASSETS)) { ASSET_ALIAS.set(k, k); for (const al of a.aliases ?? []) ASSET_ALIAS.set(al, k); }

/**
 * The mark for a company, from its CANONICAL resolved name (never the other way round: a mark never chooses a company). Order: curated full-colour
 * asset, then the bundled single-colour glyph in its brand colour, else null (the monogram). Exact normalized match only; vendors never match.
 */
export function brandFor(company: string | null | undefined): Brand | null {
  if (!company) return null;
  const n = normalizeCompany(company);
  if (!n || VENDOR_KEYS.has(n.replace(/ /g, ""))) return null;
  const key = ALIASES[n] ?? n.replace(/ /g, "");
  const asset = Object.hasOwn(BRAND_ASSETS, key) ? key : ASSET_ALIAS.get(key);
  if (asset) { const a = BRAND_ASSETS[asset]; return { kind: "image", key: asset, name: a.name, src: a.src, fit: a.fit }; }
  const hit = Object.hasOwn(LOGOS, key) ? LOGOS[key] : undefined;
  return hit ? { kind: "glyph", key, name: hit.name, path: hit.path, color: hit.color } : null;
}

/** Brands light enough that their colour would vanish on the neutral tile (Snapchat yellow, Robinhood lime, Sony white): they sit on a dark tile instead. */
export function isLightBrand(hex: string): boolean {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.55;
}
