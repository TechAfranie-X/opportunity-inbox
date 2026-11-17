import { RECRUITING_QUERY } from "../gmail/queries.ts";

/**
 * A local model of what the product's Gmail search (`RECRUITING_QUERY`) would match, for measurement only.
 *
 * It is derived from the query string itself so the two cannot drift apart. Gmail's matching is approximated: `subject:`
 * terms match whole words (a quoted phrase matches consecutive words), case-insensitively; `from:` terms match anywhere in
 * the sender. Gmail also stems and tokenises in ways this does not reproduce, so treat results as an estimate.
 */
function groupAfter(query: string, operator: string): string[] {
  const m = new RegExp(`${operator}:\\(([^)]*)\\)`).exec(query);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"|(\S+)/g)].map((t) => t[1] ?? t[2]).filter((t) => t !== "OR");
}

const SUBJECT_TERMS = groupAfter(RECRUITING_QUERY, "subject").map((t) => t.toLowerCase().split(/\s+/));
const FROM_TERMS = groupAfter(RECRUITING_QUERY, "from").map((t) => t.toLowerCase());

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function matchesLegacyQuery(from: string, subject: string): boolean {
  const f = from.toLowerCase();
  if (FROM_TERMS.some((t) => f.includes(t))) return true;
  const w = words(subject);
  return SUBJECT_TERMS.some((phrase) => {
    for (let i = 0; i + phrase.length <= w.length; i += 1) if (phrase.every((p, j) => w[i + j] === p)) return true;
    return false;
  });
}

export const LEGACY_QUERY_TERMS = { subject: SUBJECT_TERMS.map((p) => p.join(" ")), from: FROM_TERMS };
