import { lookupKeys } from "./names.ts";

/**
 * What kind of thing a "company" string names. Extraction sometimes returns a program, event, fellowship or publication where an employer should be
 * ("Heidelberg Laureate Forum", "Kleiner Perkins Fellows", "Deloitte Digital's Salesforce Academy", "Constellations Fellowship"). The rule is structural, not a
 * list of examples: a name whose head noun is a program word names a program; the organization behind it, if any, is what precedes it ("X Fellows" -> X,
 * "X's Y Academy" -> X). The caller decides whether that sponsor resolves to a known organization; a program with no resolvable sponsor never gets a
 * domain or a fetched logo, because there is no employer to attribute it to.
 */
const PROGRAM_NOUN = /^(?:fellowships?|fellows|forum|summit|conference|initiative|academy|programs?|programmes?|challenge|hackathon|fest|festival|scholars?|scholarship|newsletter|digest|workshop|webinar|bootcamp|corps|prize|award|cohort|series|expo|symposium)$/i;

export type OrgClass = { kind: "employer" | "program"; /** the organization a program is run by, when the name carries one (unverified) */ sponsor: string | null };

export function classifyOrgName(name: string): OrgClass {
  const cleaned = name.replace(/\([^)]*\)/g, " ").replace(/\b(?:19|20)\d\d\b/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 2) return { kind: "employer", sponsor: null };
  const last = words[words.length - 1].replace(/[^A-Za-z]/g, "");
  if (!PROGRAM_NOUN.test(last)) return { kind: "employer", sponsor: null };
  const head = words.slice(0, -1);
  const possessive = head.findIndex((w) => /[’']s$/i.test(w));
  const sponsorWords = possessive >= 0 ? head.slice(0, possessive + 1).map((w, i) => (i === possessive ? w.replace(/[’']s$/i, "") : w)) : head;
  const sponsor = sponsorWords.join(" ").trim();
  return { kind: "program", sponsor: sponsor.length >= 2 && lookupKeys(sponsor).length > 0 ? sponsor : null };
}
