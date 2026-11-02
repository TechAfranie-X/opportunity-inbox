import { parseSender } from "../opportunities/normalize.ts";

/** Applicant-tracking / assessment / job-board senders: the sender is NOT the company. */
const PLATFORM_DOMAINS = [
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
];

const FREE_MAIL = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me"];

const GENERIC_WORDS = new Set([
  "greenhouse", "lever", "workday", "ashby", "icims", "smartrecruiters", "workable",
  "hackerrank", "codesignal", "codility", "hirevue", "linkedin", "indeed", "handshake",
  "noreply", "no-reply", "careers", "jobs", "recruiting", "talent", "hiring",
  "notifications", "mail", "team", "the", "your", "our", "hr", "people", "job", "application", "internship", "update",
]);

const COMPANY_SUFFIX =
  /\s+(?:university recruiting|early careers?|campus recruiting|recruiting team|talent acquisition|talent team|recruiting|careers?|talent|hiring team|hiring|jobs|team|people|hr|notifications?)$/i;

const ROLE_WORD =
  /\b(?:intern|internship|engineer|developer|analyst|scientist|designer|manager|associate|researcher|consultant|architect|specialist|co-?op|fellow|apprentice|programmer|position|role)\b/i;

const WORD = "[A-Za-z0-9&'’\\-]+(?:\\.[A-Za-z0-9]+)*";
const CAP = `([A-Z]${WORD.slice(0)}(?: (?:[A-Z0-9]${WORD}|of|and|&)){0,3})`;

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
  new RegExp(`^${CAP}:\\s`), // "Stripe: Online Assessment …"
  new RegExp(`^${CAP}\\s+\\|\\s`), // "BlackRock | Application update"
  new RegExp(`\\b${K("your")}\\s+${CAP}\\s+(?:(?:${K("coding")}|${K("online")}|${K("technical")})\\s+)?(?:${K("assessment")}|${K("interview")}|${K("application")}|${K("offer")}|${K("challenge")})\\b`),
  new RegExp(`\\b(?:${K("position")}|${K("role")}|${K("internship")}|${K("co-op")}|${K("opportunity")}|${K("job")}|${K("interview")}|${K("offer")}|${K("application")})\\s+(?:${K("at")}|${K("with")})\\s+${CAP}`),
  new RegExp(`\\b(?:${K("applying")}|${K("applied")}|${K("application")})\\s+(?:${K("to")}|${K("at")}|${K("with")})\\s+(?:${K("the")}\\s+)?${CAP}`),
  new RegExp(`\\b${K("interest")} ${K("in")} (?:${KS("working at")}|${KS("working for")}|${KS("working with")}|${K("joining")}|${KS("a career at")}|${KS("careers at")})\\s+${CAP}`),
  new RegExp(`\\b(?:${KS("welcome to")}|${K("joining")}|${K("join")}|${KS("team at")}|${KS("careers at")}|${KS("working at")}|${KS("working for")})\\s+${CAP}`),
  new RegExp(`\\b${K("from")} ${K("the")} ${CAP} (?:${K("recruiting")} |${K("talent")} |${K("hiring")} |${K("university")} |${K("campus")} )?${K("team")}\\b`),
  new RegExp(`\\b${CAP} (?:${K("recruiting")}|${K("talent")}|${K("careers")}|${K("hiring")}|${K("university recruiting")}) ${K("team")}\\b`),
  new RegExp(`\\b(?:${K("at")}|${K("with")})\\s+${CAP}[.!,]`),
];

function titleCase(label: string) {
  if (!label) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function registrableLabel(domain: string) {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return "";
  const twoPartTld = ["co", "com", "org", "ac"].includes(parts[parts.length - 2]) && parts.length >= 3;
  return parts[parts.length - (twoPartTld ? 3 : 2)];
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

function cleanCandidate(raw: string): string | null {
  const value = raw
    .replace(/\s+(?:of|and|&)$/i, "")
    .replace(/\s+(?:application|update|assessment|interview|offer|status|confirmation|invitation|reminder|notification|account)$/i, "")
    .replace(/[.,!]+$/, "")
    .trim();
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
]);

/**
 * Company from a sender display name. Returns null for addresses, people-style
 * generic senders and anything that reduces to noise words ("Workday System").
 */
function companyFromDisplayName(rawFrom: string): string | null {
  const display = rawFrom.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
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
function recoverBrandName(label: string, text: string) {
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
      if (target.startsWith(g) && g.length >= 0.6 * target.length && (!best || g.length > flat(best).length)) best = gram;
    }
  }
  return best ?? titleCase(label);
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
    if (fromText && fl && (fl.includes(flat(fromText)) || flat(fromText).includes(fl))) return fromText;
    if (display && fl && (flat(display).includes(fl) || fl.includes(flat(display)))) return display;
    return label ? recoverBrandName(label, text) : fromText;
  }

  // Platform / personal mail: the company must come from the content.
  const fromText = companyFromText(input.subject, body);
  if (fromText) return fromText;
  const display = companyFromDisplayName(input.from);
  if (display) return display;
  // Workday tenants are addressed as <tenant>@myworkday.com.
  if (/(^|\.)myworkday\.com$/.test(domain) && sender.localPart && !SENDER_NOISE.has(sender.localPart) && !/reply/.test(sender.localPart)) {
    return titleCase(sender.localPart);
  }
  return null;
}

const ROLE_KW =
  "(?:Intern(?:ship)?|Engineer(?:ing)?|Developer|Analyst|Scientist|Designer|Manager|Associate|Researcher|Consultant|Architect|Specialist|Co-?op|Fellow|Apprentice|Programmer)";
const ROLE_CAP = `((?:[A-Z0-9][\\w+#&./'’\\-]*\\s+){0,4}${ROLE_KW}(?:\\s+(?:Intern|Co-?op))?(?:\\s*\\([^)]{1,30}\\))?)`;

const ROLE_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:for|to|as|of)\\s+(?:the\\s+|an?\\s+)?${ROLE_CAP}(?:\\s+(?:position|role|internship|opportunity|job))?`),
  new RegExp(`${ROLE_CAP}\\s+(?:position|role|opportunity)\\b`),
  new RegExp(`^${ROLE_CAP}`, "m"),
  new RegExp(`[-–:|]\\s*${ROLE_CAP}`),
  new RegExp(`\\b${ROLE_CAP}\\b`),
];

export function inferRole(subject: string, body: string): string | null {
  for (const text of [subject, body.slice(0, 1500)]) {
    for (const pattern of ROLE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const role = match[1].replace(/\s+/g, " ").trim();
        if (role.length >= 4 && !/^(?:Software|Hiring|Engineering) (?:Team|Manager)$/i.test(role)) {
          return role;
        }
      }
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
