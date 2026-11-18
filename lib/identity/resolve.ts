import { LOGOS } from "./logos.ts";

/**
 * Company identity as a presentation asset. Input: the already-resolved employer name (never email text). Output: a bundled public mark, or null.
 * Rules: exact match after normalisation only (no fuzzy guessing); applicant-tracking and job-board vendors are never an employer; no mark is
 * ever invented. Pure and local: no network.
 */

/** Vendors that send recruiting mail on an employer's behalf. Their marks must never stand in for the employer. */
const VENDORS = new Set([
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

export type Brand = { key: string; name: string; path: string };

export function brandFor(company: string | null | undefined): Brand | null {
  if (!company) return null;
  const n = normalizeCompany(company);
  if (!n || VENDORS.has(n.replace(/ /g, ""))) return null;
  const key = ALIASES[n] ?? n.replace(/ /g, "");
  const hit = Object.hasOwn(LOGOS, key) ? LOGOS[key] : undefined;
  return hit ? { key, name: hit.name, path: hit.path } : null;
}
