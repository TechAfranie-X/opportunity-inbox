import { roleTokens } from "../recruiting/company.ts";

/**
 * What a role string says about WHICH recruiting cycle and program it belongs to, separated from WHAT the role is. The old matcher threw years, seasons and
 * programs away as noise, so "Summer 2026" and "Summer 2027" looked identical and an externship looked like an internship. These helpers keep them as identity.
 */
export type Cycle = { years: number[]; seasons: string[] };

const SEASON = /\b(summer|fall|autumn|winter|spring)\b/gi;
export function cycleOf(text: string | null | undefined): Cycle {
  if (!text) return { years: [], seasons: [] };
  const years = [...new Set([...text.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1])))].sort();
  const seasons = [...new Set([...text.matchAll(SEASON)].map((m) => m[1].toLowerCase().replace("autumn", "fall")))].sort();
  return { years, seasons };
}

/** Two cycles conflict when both are stated and cannot be the same one: no shared year, or the same year with no shared season. */
export function cyclesConflict(a: Cycle, b: Cycle): boolean {
  if (a.years.length === 0 || b.years.length === 0) return false;
  const shared = a.years.filter((y) => b.years.includes(y));
  if (shared.length === 0) return true;
  if (a.seasons.length > 0 && b.seasons.length > 0 && !a.seasons.some((s) => b.seasons.includes(s))) return true;
  return false;
}

const PROGRAMS: Array<[string, RegExp]> = [
  ["externship", /\bexternships?\b/i], ["fellowship", /\bfellow(?:ship)?s?\b/i], ["symposium", /\bsymposium\b/i], ["interest-form", /\binterest form\b/i],
  ["apprenticeship", /\bapprentice(?:ship)?s?\b/i], ["co-op", /\bco-?op\b/i], ["hackathon", /\bhackathon\b/i], ["fulltime", /\b(?:full[- ]?time|new[- ]?grad(?:uate)?)\b/i],
];
/** Program markers a role names. "Intern" and "Internship" are the default and carry none. */
export function programsOf(role: string | null | undefined): string[] {
  if (!role) return [];
  return PROGRAMS.filter(([, re]) => re.test(role)).map(([name]) => name).sort();
}

const EXTRA_NOISE = new Set(["bs", "ms", "phd", "ba", "mba", "bsc", "msc", "degree", "virtual", "remote", "onsite", "hybrid", "externship", "fellowship", "fellows", "symposium", "interest", "form", "apprenticeship", "hackathon", "full", "time", "fulltime"]);
/** Prose that was mistaken for a role ("and giving us the"): it starts with a function word. It carries no identity. */
export const isRoleFragment = (role: string | null | undefined) => !!role && /^(?:and|or|the|of|to|a|an|for|in|on|with|that|this|your|our)\b/i.test(role.trim());

/** The identity tokens of a role: what the job is, without cycle, degree level, delivery mode or program. */
export function roleCore(role: string | null | undefined): string[] {
  if (!role || isRoleFragment(role)) return [];
  return roleTokens(role).filter((t) => !EXTRA_NOISE.has(t));
}

export type RoleRelation = "match" | "generic" | "conflict";
export function roleRelationV2(a: string | null | undefined, b: string | null | undefined): RoleRelation {
  const ta = roleCore(a), tb = roleCore(b);
  if (ta.length === 0 || tb.length === 0) return "generic";
  const shared = ta.filter((t) => tb.includes(t)).length;
  return shared / Math.min(ta.length, tb.length) >= 0.6 ? "match" : "conflict";
}

/** Do two named roles describe different programs? Only meaningful when both roles are actually stated. */
export function programsConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || isRoleFragment(a) || isRoleFragment(b)) return false;
  const pa = programsOf(a), pb = programsOf(b);
  return (pa.length > 0 || pb.length > 0) && pa.join() !== pb.join();
}
