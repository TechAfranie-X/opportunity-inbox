import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The local brand cache: one file per company domain plus an index, in the app's own data directory (BRAND_CACHE_DIR, default ./.data/brands, git-ignored).
 * An asset is fetched at most once per domain; a failure is remembered (negative cache) and retried only after RETRY_DAYS. Rendering only ever reads this
 * cache; it never triggers a fetch. The index maps companies to domains so the UI can ask "is there a cached mark for this company?".
 */
export type CacheEntry =
  | { status: "ok"; file: string; kind: "svg" | "png"; width: number | null; height: number | null; from: "manifest" | "apple-touch-icon" | "icon" | "svg"; source: "learned" | "graph" | "sender"; at: string }
  | { status: "none"; reason: string; source: "learned" | "graph" | "sender"; at: string };
export type CacheIndex = { domains: Record<string, CacheEntry>; /** company key -> domain */ companies: Record<string, string> };

export const RETRY_DAYS = 30;
export const cacheDir = () => process.env.BRAND_CACHE_DIR ?? join(process.cwd(), ".data", "brands");
const indexPath = () => join(cacheDir(), "index.json");

export function readIndex(): CacheIndex {
  try {
    return existsSync(indexPath()) ? (JSON.parse(readFileSync(indexPath(), "utf8")) as CacheIndex) : { domains: {}, companies: {} };
  } catch {
    return { domains: {}, companies: {} };
  }
}

export function writeIndex(index: CacheIndex) {
  mkdirSync(cacheDir(), { recursive: true });
  const tmp = `${indexPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(index));
  renameSync(tmp, indexPath());
}

export function writeAsset(file: string, data: Buffer | string) {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(join(cacheDir(), file), data);
}

export const readAsset = (file: string): Buffer | null => {
  if (!/^[a-z0-9][a-z0-9.-]*\.(?:png|svg)$/.test(file)) return null;
  try {
    return readFileSync(join(cacheDir(), file));
  } catch {
    return null;
  }
};

/** Should this domain be fetched now? Never for a cached success; not before the retry window for a failure. */
export function shouldFetch(entry: CacheEntry | undefined, now = Date.now()): boolean {
  if (!entry) return true;
  if (entry.status === "ok") return false;
  return now - Date.parse(entry.at) > RETRY_DAYS * 86_400_000;
}

/**
 * company key -> URL of its cached mark, for the UI. The cache is shared by everyone on an install, so a caller must pass `only`: the company keys that
 * THIS person's own opportunities contain. Without it nothing is returned: one person's employers are never sent to another's browser.
 */
export function cachedBrandUrls(only: Iterable<string>, index = readIndex()): Record<string, string> {
  const out: Record<string, string> = {};
  const mine = new Set(only);
  for (const [key, domain] of Object.entries(index.companies)) {
    if (!mine.has(key)) continue;
    const e = index.domains[domain];
    if (e?.status === "ok") out[key] = `/brands/cache/${e.file}?v=${Date.parse(e.at) || 0}`; // the version keeps a browser from showing a stale or superseded asset
  }
  return out;
}
