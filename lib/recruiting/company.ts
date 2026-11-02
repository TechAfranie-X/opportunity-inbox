import { parseSender } from "../opportunities/normalize.ts";

/** Applicant-tracking / assessment / job-board senders: the sender is NOT the company. */
export const PLATFORM_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "myworkday.com", "workday.com",
  "ashbyhq.com", "icims.com", "smartrecruiters.com", "workable.com", "jobvite.com",
  "taleo.net", "successfactors.com", "brassring.com", "bamboohr.com", "breezy.hr",
  "recruitee.com", "teamtailor.com", "hackerrank.com", "codesignal.com", "codility.com",
  "hirevue.com", "karat.com", "linkedin.com", "indeed.com", "handshake.com",
  "joinhandshake.com", "wellfound.com", "ripplematching.com", "calendly.com",
  "goodtime.io", "gem.com", "metaview.ai",
  // ATS / assessment / program platforms whose mail names a different company
  "oracle.com", "oraclecloud.com", "tal.net", "applicantemails.com", "applyresponse.com",
  "coderpad.io", "theforage.com", "ripplematch.com", "applytojob.com", "jazzhr.com",
  "paylocity.com", "ultipro.com", "dayforcehcm.com", "eightfold.ai", "phenom.com",
  "beamery.com", "avature.net", "careerhub.com", "isolvedhire.com", "starred.com",
  "interfolio.com", "emailmeform.com", "linklings.com", "hackerrankforwork.com", "submittable.com",
  "slate.org", "technolutions.com", "formstack.com", "typeform.com", "jotform.com",
  "yello.co", "smapply.net", "modernhire.com", "zeffy.com", "predictiveindex.com", "fillout.com", "modernloop.io", "formassembly.com", "hirevue.com", "paradox.ai", "olivia.paradox.ai",
];

const FREE_MAIL = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me"];

const GENERIC_WORDS = new Set([
  "greenhouse", "lever", "workday", "ashby", "icims", "smartrecruiters", "workable",
  "hackerrank", "codesignal", "codility", "hirevue", "linkedin", "indeed", "handshake",
  "noreply", "no-reply", "careers", "jobs", "recruiting", "talent", "hiring",
  "notifications", "mail", "team", "the", "your", "our", "hr", "people", "job", "application", "internship", "update",
]);

const ROLE_WORD =
  /\b(?:intern|internship|engineer|developer|analyst|scientist|designer|manager|associate|researcher|consultant|architect|specialist|co-?op|fellow|apprentice|programmer|position|role)\b/i;

const WORD = "[A-Za-z0-9&'’\\-]+(?:\\.[A-Za-z0-9]+)*";
const CAP = `((?:[A-Z]|[a-z](?=[A-Z]))${WORD}(?: (?:[A-Z0-9]${WORD}|of|and|&)){0,3})`;

/** Case-insensitive keyword inside an otherwise case-sensitive pattern (company names need capitals). */
const K = (word: string) => word.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const KS = (phrase: string) => phrase.split(" ").map(K).join("\\s+");

// Ordered most-specific first. Keywords are case-insensitive; the captured name must be Capitalised.
const COMPANY_PATTERNS: RegExp[] = [
  // Assessment-platform phrasing: "X invited you to…", "Request from X has expired", "Reminder: X is waiting…", "Next step: X online…"
  new RegExp(`^${CAP}\\s+(?:${K("has")}\\s+)?${K("invited")} ${K("you")}\\b`),
  new RegExp(`\\b(?:${K("request")}|${K("invitation")}|${K("assessment")})\\s+${K("from")}\\s+${CAP}\\b`),
  new RegExp(`\\b${CAP}\\s+${K("is")}\\s+${K("waiting")}\\s+${K("for")}\\s+${K("your")}\\b`),
  new RegExp(`${K("next")}\\s+${K("step")}:\\s*${CAP}\\b`),
  new RegExp(`\\b(?:${K("complete")}|${K("take")}|${K("finish")})\\s+(?:${K("your")}|${K("the")})\\s+${CAP}\\s+(?:${K("pre-screen")}|${K("prescreen")}|${K("coding")}|${K("test")})`),
  new RegExp(`${K("reminder")}:\\s*${CAP}\\s+(?:${K("test")}|${K("assessment")}|${K("coding")}|${K("interview")}|${K("application")})`),
  new RegExp(`${K("result")}\\s+${K("for")}\\s+${CAP}\\b`),
  new RegExp(`^${CAP}:\\s`), // "Stripe: Online Assessment …"
  new RegExp(`^${CAP}\\s+\\|\\s`), // "BlackRock | Application update"
  new RegExp(`^${CAP}\\s+(?:${K("event")}\\s+|${K("program")}\\s+)?${K("application")}\\s+(?:${K("update")}|${K("status")}|${K("received")})`), // "Morgan Stanley Event Application Update"
  new RegExp(`${K("assessment")} ${K("completed")}:\\s*${CAP}`), // "Assessment completed: X Pre-Screen"
  new RegExp(`\\b${K("your")}\\s+${CAP}\\s+(?:(?:${K("coding")}|${K("online")}|${K("technical")})\\s+)?(?:${K("assessment")}|${K("interview")}|${K("application")}|${K("offer")}|${K("challenge")})\\b`),
  new RegExp(`\\b(?:${K("position")}|${K("role")}|${K("internship")}|${K("co-op")}|${K("opportunity")}|${K("job")}|${K("interview")}|${K("offer")}|${K("application")})\\s+(?:${K("at")}|${K("with")})\\s+${CAP}`),
  new RegExp(`\\b(?:${K("applying")}|${K("applied")}|${K("application")})\\s+(?:${K("to")}|${K("at")}|${K("with")})\\s+(?:${K("the")}\\s+)?${CAP}`),
  new RegExp(`\\b${K("interest")} ${K("in")} (?:${KS("working at")}|${KS("working for")}|${KS("working with")}|${K("joining")}|${KS("a career at")}|${KS("careers at")})\\s+${CAP}`),
  new RegExp(`\\b(?:${KS("welcome to")}|${K("joining")}|${K("join")}|${KS("team at")}|${KS("careers at")}|${KS("working at")}|${KS("working for")})\\s+${CAP}`),
  new RegExp(`\\b${K("from")} ${K("the")} ${CAP} (?:${K("recruiting")} |${K("talent")} |${K("hiring")} |${K("university")} |${K("campus")} )?${K("team")}\\b`),
  new RegExp(`\\b${CAP} (?:${K("recruiting")}|${K("talent")}|${K("careers")}|${K("hiring")}|${K("university recruiting")}) ${K("team")}\\b`),
  new RegExp(`\\b(?:${K("at")}|${K("with")})\\s+${CAP}[.!,]`),
  new RegExp(`\\b${K("with")}\\s+${CAP}\\s+(?:${K("was")}|${K("were")}|${K("has")}|${K("have")}|${K("is")}|${K("are")})\\b`), // "availability with Acme was submitted"
];

export function titleCase(label: string) {
  if (!label) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const LABEL_NOISE = ["recruiting", "recruitment", "careers", "career", "jobs", "talent", "hiring", "mailer", "email", "mail", "apply"];

/** "drwrecruiting" -> "drw", "talent-citadel" -> "citadel". Keeps the original if nothing is left. */
function stripLabelNoise(label: string) {
  let value = label;
  for (const noise of LABEL_NOISE) {
    value = value.split("-").filter((part) => part !== noise).join("-");
    if (value.endsWith(noise) && value.length > noise.length + 2) value = value.slice(0, -noise.length);
  }
  return value || label;
}

export function registrableLabel(domain: string) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return "";
  const twoPartTld = ["co", "com", "org", "ac"].includes(parts[parts.length - 2]) && parts.length >= 3;
  return stripLabelNoise(parts[parts.length - (twoPartTld ? 3 : 2)]);
}

export function isPlatformDomain(domain: string) {
  return PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function isFreeMailDomain(domain: string) {
  return FREE_MAIL.includes(domain);
}

/** Subject-lead phrases that look like a "Company:" prefix but are not companies. */
const GENERIC_LEAD =
  /^(?:action(?: needed| required)?|reminder|urgent|important|final|apply|new|thank|thanks|welcome|congratulations?|last|update|your|application|re|fwd?|next step|follow[- ]?up|notice|alert|invitation|interview|assessment|offer|security)\b/i;

const TRAILING_GENERIC =
  /\s+(?:application|update|assessment|interview|offer|status|confirmation|invitation|reminder|notification|account|coding|online|technical|event|pre-screen|prescreen|pre-screening|screen|challenge|test)$/i;

function cleanCandidate(raw: string): string | null {
  let value = raw;
  for (let i = 0; i < 3; i += 1) value = value.replace(TRAILING_GENERIC, "");
  value = value.replace(/\s+(?:of|and|&)$/i, "").replace(/[.,!]+$/, "").trim();
  if (GENERIC_LEAD.test(value)) return null;
  if (value.length < 2) return null;
  const lower = value.toLowerCase();
  if (GENERIC_WORDS.has(lower)) return null;
  if (ROLE_WORD.test(value)) return null;
  if (/^(?:the|our|your|us|you|this|that|a|an)\b/i.test(value)) return null;
  return value;
}

/** Subject is the most reliable text, so it is searched first; the body only fills gaps. */
export function companyFromText(subject: string, body = ""): string | null {
  for (const text of [subject, body]) {
    if (!text) continue;
    for (const pattern of COMPANY_PATTERNS) {
      const match = text.match(pattern);
      const candidate = match ? cleanCandidate(match[1]) : null;
      if (candidate) return candidate;
    }
  }
  return null;
}

const SENDER_NOISE = new Set([
  "do", "not", "reply", "noreply", "no", "donotreply", "do-not-reply", "no-reply", "workday",
  "system", "notifications", "notification", "recruiting", "careers", "career", "talent", "hr",
  "jobs", "job", "team", "admin", "automated", "support", "mailer", "via", "the", "hiring",
  "university", "campus", "early", "acquisition", "recruitment", "people", "candidate", "experience",
  "business", "process", "workflow", "onboarding", "alerts", "admissions",
]);

/**
 * Company from a sender display name. Returns null for addresses, people-style
 * generic senders and anything that reduces to noise words ("Workday System").
 */
export function companyFromDisplayName(rawFrom: string): string | null {
  const display = rawFrom.replace(/<[^>]+>/g, "").replace(/["']/g, "").split(/\s[-|–]\s/)[0].trim();
  if (!display || display.includes("@")) return null;
  const tokens = display
    .replace(/[._]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !t.toLowerCase().split("-").every((part) => SENDER_NOISE.has(part)));
  if (tokens.length === 0) return null;
  const name = tokens.join(" ");
  if (GENERIC_WORDS.has(name.toLowerCase())) return null;
  return name === name.toLowerCase() ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

/**
 * Recover a properly spelled brand from the email text when we only have a domain label:
 * "datadoghq" -> "Datadog", "owenscorning" -> "Owens Corning", "mongodb" -> "MongoDB".
 * The text spelling must cover most of the label, so a stub ("Last" of "lastmile-ed") never wins.
 */
export function recoverBrandName(label: string, text: string) {
  const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = flat(label);
  const words = [...text.matchAll(/\b[A-Z][A-Za-z0-9]*\b/g)].map((m) => m[0]);
  let best: string | null = null;
  for (let i = 0; i < words.length; i += 1) {
    for (let n = 1; n <= 3 && i + n <= words.length; n += 1) {
      const gram = words.slice(i, i + n).join(" ");
      const g = flat(gram);
      if (g.length < 3) continue;
      if (g === target) return gram;
      // "hudson-trading" -> "Hudson River Trading": each hyphen part must start a word, in order.
      const parts = label.toLowerCase().split("-").filter(Boolean);
      if (parts.length > 1) {
        const lowerWords = gram.toLowerCase().split(" ");
        let at = 0;
        const ordered = parts.every((part) => {
          const idx = lowerWords.findIndex((w, k) => k >= at && w.startsWith(part));
          if (idx < 0) return false;
          at = idx + 1;
          return true;
        });
        if (ordered && lowerWords.length <= parts.length + 1) return gram;
      }
      if (target.startsWith(g) && g.length >= 0.6 * target.length && (!best || g.length > flat(best).length)) best = gram;
    }
  }
  return best ?? titleCase(label);
}

const ORG_WORDS = new Set([
  "ai", "labs", "lab", "capital", "trading", "group", "systems", "space", "bank", "health", "tech", "technologies",
  "software", "partners", "financial", "securities", "investments", "research", "energy", "media", "cloud", "data",
  "network", "networks", "robotics", "games", "foods", "airlines", "motors", "industries", "analytics", "security",
  "institute", "university", "college", "foundation", "fund", "fellowship", "program", "academy", "school",
  "relations", "services", "solutions", "global", "international", "company", "holdings", "studios",
  "entertainment", "pharma", "therapeutics", "brands", "stores", "logistics", "careers", "recruiting",
]);

/** "Julia Ngo" is a recruiter, "Advanced Space" is a company: two capitalised words and no organisation word. */
export function looksLikePerson(name: string) {
  const words = name.split(/\s+/);
  if (words.length !== 2 || !words.every((w) => /^[A-Z][a-z]+$/.test(w))) return false;
  return !words.some((w) => ORG_WORDS.has(w.toLowerCase()));
}

export function inferCompany(input: {
  from: string;
  subject: string;
  body: string;
}): string | null {
  const sender = parseSender(input.from);
  const domain = sender.domain;
  const body = input.body.slice(0, 2500);
  const text = `${input.subject}\n${body}`;
  const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (domain && !isPlatformDomain(domain) && !isFreeMailDomain(domain)) {
    const label = registrableLabel(domain);
    const fromText = companyFromText(input.subject, body);
    const display = companyFromDisplayName(input.from);
    const fl = flat(label);
    // The name used in the content wins when it is consistent with the domain
    // ("Notion" in the text vs "makenotion.com"): same brand, nicer spelling.
    const initials = fromText ? fromText.split(/\s+/).map((w) => w[0]?.toLowerCase() ?? "").join("") : "";
    if (fromText && fl && (fl.includes(flat(fromText)) || flat(fromText).includes(fl) || (fl.length <= 4 && fl === initials))) return fromText;
    if (display && fl && (flat(display).includes(fl) || fl.includes(flat(display)))) return display;
    return label ? recoverBrandName(label, text) : fromText;
  }

  // Platform / personal mail: the company must come from the content.
  const fromText = companyFromText(input.subject, body);
  if (fromText) return fromText;
  const display = companyFromDisplayName(input.from);
  if (display && !looksLikePerson(display)) return display;
  // Workday tenants are addressed as <tenant>@myworkday.com.
  if (/(^|\.)myworkday\.com$/.test(domain) && sender.localPart && !SENDER_NOISE.has(sender.localPart) && !/reply/.test(sender.localPart)) {
    return titleCase(sender.localPart);
  }
  return null;
}

const ROLE_KW =
  "(?:Intern(?:ship)?|Engineer(?:ing)?|Developer|Analyst|Scientist|Designer|Manager|Associate|Researcher|Consultant|Architect|Specialist|Co-?op|Fellow|Apprentice|Programmer)";
const ROLE_CAP = `((?<![\\w-])(?:[A-Z0-9][\\w+#&./'’\\-]*\\s+){0,4}${ROLE_KW}(?:\\s+(?:Intern|Co-?op))?(?:\\s*\\([^)]{1,30}\\))?)`;

const ROLE_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:for|to|as|of)\\s+(?:the\\s+|an?\\s+)?${ROLE_CAP}(?:\\s+(?:position|role|internship|opportunity|job))?`),
  new RegExp(`${ROLE_CAP}\\s+(?:position|role|opportunity)\\b`),
  new RegExp(`^${ROLE_CAP}`, "m"),
  new RegExp(`[-–:|]\\s*${ROLE_CAP}`),
  new RegExp(`\\b${ROLE_CAP}\\b`),
];

/** Loose patterns are only safe in the subject; in a body they pick up recruiter signatures ("Will Shelton Student Engagement Consultant"). */
const BODY_SAFE_ROLE_PATTERNS = ROLE_PATTERNS.slice(0, 2);

const REQ_ID = /\b(?:R|JR|REQ|ID)[-_ ]?\d{4,}\b|\b\d{5,}\b/gi;
const REQ_PAREN = /\((?:\s*(?:job|req(?:uisition)?)\s*(?:number|id|#)?\s*[:#]?[^)]*|\s*id[^)]*)\)/gi;

/** Remove requisition ids, leading articles / legal suffixes and a leading company name. */
export function cleanRole(role: string, company: string | null): string | null {
  let value = role.replace(REQ_PAREN, " ").replace(REQ_ID, " ");
  if (company) {
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`^\\s*${escaped}(?:['’]s)?[,]?\\s+`, "i"), "");
  }
  let previous = "";
  while (previous !== value) {
    previous = value;
    value = value.replace(/^\s*(?:your|the|an?|inc\.?|llc|ltd\.?|corp\.?)[,]?\s+/i, "");
  }
  value = value.replace(/\s{2,}/g, " ").replace(/^[\s\-–:,|]+|[\s\-–:,|]+$/g, "").trim();
  return /[A-Za-z]{4}/.test(value) && value.length >= 4 ? value : null;
}

export function inferRole(subject: string, body: string, company: string | null = null): string | null {
  const sources: Array<[string, RegExp[]]> = [
    [subject, ROLE_PATTERNS],
    [body.slice(0, 1500), BODY_SAFE_ROLE_PATTERNS],
  ];
  for (const [text, patterns] of sources) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const cleaned = cleanRole(match[1].replace(/\s+/g, " ").trim(), company);
      if (cleaned && !/^(?:Software|Hiring|Engineering) (?:Team|Manager)$/i.test(cleaned)) return cleaned;
    }
  }
  return null;
}

/** Lowercase, punctuation-free key used for company grouping. */
export function companyKey(company: string) {
  return company.toLowerCase().replace(/\b(?:inc|llc|ltd|corp|corporation|co|company)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
}

const ROLE_NOISE = new Set([
  "intern", "internship", "internships", "summer", "fall", "spring", "winter", "new", "grad", "graduate",
  "undergraduate", "undergrad", "the", "a", "an", "of", "and", "co", "op", "job", "number", "position",
  "role", "program", "programme", "student", "students",
]);

/** Crude stemmer: enough to equate "Engineer" / "Engineering" / "Engineers". */
function stem(token: string) {
  return token.replace(/(?:ing|ers|s)$/, "").replace(/(.{4,})er$/, "$1er");
}

export function roleTokens(role: string | null): string[] {
  if (!role) return [];
  return role
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t && !ROLE_NOISE.has(t) && !/^20\d\d$/.test(t) && !/^[a-z]{0,3}\d{4,}$/.test(t))
    .map(stem);
}

export type RoleRelation = "match" | "generic" | "conflict";

/**
 * How two roles at the same company relate:
 *  - match:    clearly the same role
 *  - generic:  one side says nothing specific ("Intern", "2027 Internship", unknown) so it could be either
 *  - conflict: both specific and different ("Software Engineer" vs "Data Analyst")
 */
export function roleRelation(a: string | null, b: string | null): RoleRelation {
  const ta = roleTokens(a);
  const tb = roleTokens(b);
  if (ta.length === 0 || tb.length === 0) return "generic";
  const shared = ta.filter((t) => tb.includes(t)).length;
  return shared / Math.min(ta.length, tb.length) >= 0.6 ? "match" : "conflict";
}

export function rolesMatch(a: string | null, b: string | null) {
  return roleRelation(a, b) === "match";
}
