/**
 * Name normalization for logo lookup (light enough for the browser bundle: no graph, no seed). The product's company string is usually canonical, but
 * extraction leaves descriptors on it ("CodePath News", "Ramp 2025", "Arcesium LLC", "Allstate Insurance Company", "Volunteer at CodePath").
 * `lookupKeys` returns the keys to try, most specific first. It only ever REMOVES descriptor words from the ends of a name; it never invents a company.
 */
export const flat = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

const LEGAL = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|holdings?|group|technologies|technology|the)\b\.?/gi;
const LEADING = /^(?:volunteer(?:s)?|join|discover|apply(?: to)?|careers?|working|work|intern(?:ing)?|hiring|jobs?)\s+(?:at|with|for|@)\s+/i;
const TAIL = /\s+(?:news|newsletter|updates?|alumni|careers?|recruiting|recruitment|team|support|fellows?|fellowships?|help (?:centre|center)|notifications?|(?:19|20)\d\d)$/i;
const DROPPABLE_LAST = new Set(["insurance", "assurance", "financial", "bank", "bancorp", "pharmaceuticals", "pharma", "therapeutics", "university", "college", "institute"]);

const core = (s: string) => flat(s.replace(LEGAL, " "));

export function lookupKeys(company: string): string[] {
  let s = company.replace(/\([^)]*\)/g, " ").replace(/[’']s\b/g, "").replace(/\s+/g, " ").trim().replace(LEADING, "");
  const keys: string[] = [];
  const push = (v: string) => { const k = core(v); if (k.length >= 2 && !keys.includes(k)) keys.push(k); };
  push(s);
  for (let i = 0; i < 3 && TAIL.test(s); i++) { s = s.replace(TAIL, "").trim(); push(s); }
  // "Allstate Insurance Company" -> "Allstate Insurance" -> "Allstate"; "Stanford University" -> "Stanford"
  let words = s.replace(LEGAL, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && DROPPABLE_LAST.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1);
    push(words.join(" "));
  }
  return keys;
}

/** Ordinary words and very short names that are also companies. Not a name list: a list of names that need extra care. */
const COMMON_WORDS = new Set("scale toast ramp gem block linear square apple notion stripe plaid slack zoom mercury bolt ridge lattice snap bench pilot relay loop flex mode vault spark shift arc atlas beacon bridge canvas cloud compass crest delta drift ember fable flow forge frame ghost harbor honey iris jet kite lever lumen maple mesh nest north oak orbit pixel pulse quartz raven river rocket sage scout shore signal sky slate stack summit swift tide trail unity vector wave wise yield zero".split(" "));

export const isAmbiguousName = (name: string) => {
  const f = flat(name);
  return f.length <= 3 || COMMON_WORDS.has(f);
};

