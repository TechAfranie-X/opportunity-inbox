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
];

const FREE_MAIL = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me"];

const GENERIC_WORDS = new Set([
  "greenhouse", "lever", "workday", "ashby", "icims", "smartrecruiters", "workable",
  "hackerrank", "codesignal", "codility", "hirevue", "linkedin", "indeed", "handshake",
  "noreply", "no-reply", "careers", "jobs", "recruiting", "talent", "hiring",
  "notifications", "mail", "team", "the", "your", "our", "hr", "people",
]);

const COMPANY_SUFFIX =
  /\s+(?:university recruiting|early careers?|campus recruiting|recruiting team|talent acquisition|talent team|recruiting|careers?|talent|hiring team|hiring|jobs|team|people|hr|notifications?)$/i;

const ROLE_WORD =
  /\b(?:intern|internship|engineer|developer|analyst|scientist|designer|manager|associate|researcher|consultant|architect|specialist|co-?op|fellow|apprentice|programmer|position|role)\b/i;

const WORD = "[A-Za-z0-9&'’\\-]+(?:\\.[A-Za-z0-9]+)*";
const CAP = `([A-Z]${WORD.slice(0)}(?: (?:[A-Z0-9]${WORD}|of|and|&)){0,3})`;

// Ordered most-specific first.
const COMPANY_PATTERNS: RegExp[] = [
  new RegExp(`^${CAP}:\\s`), // "Stripe: Online Assessment …"
  new RegExp(`\\byour ${CAP} (?:assessment|interview|application|offer|challenge)\\b`),
  new RegExp(`\\b(?:position|role|internship|co-?op|opportunity|job|interview|offer|application)\\s+(?:at|with)\\s+${CAP}`),
  new RegExp(`\\b(?:applying|applied|application)\\s+(?:to|at|with)\\s+(?:the\\s+)?${CAP}`),
  new RegExp(`\\binterest in (?:working (?:at|for|with)|joining|a career at|careers? at)\\s+${CAP}`),
  new RegExp(`\\b(?:welcome to|joining|join|team at|careers? at|working (?:at|for))\\s+${CAP}`),
  new RegExp(`\\bfrom the ${CAP} (?:recruiting |talent |hiring |university |campus )?team\\b`),
  new RegExp(`\\b${CAP} (?:recruiting|talent|careers|hiring|university recruiting) team\\b`),
  new RegExp(`\\b(?:at|with)\\s+${CAP}[.!,]`),
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

function cleanCandidate(raw: string): string | null {
  const value = raw.replace(/[.,!]+$/, "").trim();
  if (value.length < 2) return null;
  const lower = value.toLowerCase();
  if (GENERIC_WORDS.has(lower)) return null;
  if (ROLE_WORD.test(value)) return null;
  if (/^(?:the|our|your|us|you|this|that|a|an)\b/i.test(value)) return null;
  return value;
}

export function companyFromText(text: string): string | null {
  for (const pattern of COMPANY_PATTERNS) {
    const match = text.match(pattern);
    const candidate = match ? cleanCandidate(match[1]) : null;
    if (candidate) return candidate;
  }
  return null;
}

/** Display name with "Recruiting"/"Careers"… stripped; null when it's a person or generic. */
function companyFromDisplayName(rawFrom: string): string | null {
  const display = rawFrom.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
  const stripped = display.replace(COMPANY_SUFFIX, "").trim();
  if (!stripped || GENERIC_WORDS.has(stripped.toLowerCase())) return null;
  return stripped;
}

/** "datadoghq" -> "Datadog" when the email text contains that capitalized brand. */
function recoverBrandName(label: string, text: string) {
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9]{3,}\b/g)) {
    const word = m[0].toLowerCase();
    if (word !== label && label.startsWith(word)) return m[0];
  }
  return titleCase(label);
}

export function inferCompany(input: {
  from: string;
  subject: string;
  body: string;
}): string | null {
  const sender = parseSender(input.from);
  const domain = sender.domain;
  const text = `${input.subject}\n${input.body.slice(0, 2500)}`;

  if (domain && !isPlatformDomain(domain) && !isFreeMailDomain(domain)) {
    const label = registrableLabel(domain);
    const display = companyFromDisplayName(input.from);
    const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (display && label && (flat(display).includes(flat(label)) || flat(label).includes(flat(display)))) {
      return display;
    }
    return label ? recoverBrandName(label, text) : companyFromText(text);
  }

  // Platform / personal mail: the company must come from the content.
  return companyFromText(text) ?? companyFromDisplayName(input.from);
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

const ROLE_NOISE = new Set(["intern", "internship", "summer", "fall", "spring", "winter", "new", "grad", "the", "a", "an", "of", "and", "co", "op"]);

export function roleTokens(role: string | null): string[] {
  if (!role) return [];
  return role
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t && !ROLE_NOISE.has(t) && !/^20\d\d$/.test(t));
}

export function rolesMatch(a: string | null, b: string | null) {
  const ta = roleTokens(a);
  const tb = roleTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const shared = ta.filter((t) => tb.includes(t)).length;
  return shared / Math.min(ta.length, tb.length) >= 0.6;
}
