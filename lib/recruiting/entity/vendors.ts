import { parseSender } from "../../opportunities/normalize.ts";
import { PLATFORM_DOMAINS } from "../company.ts";

/**
 * Who is *sending* a message, as opposed to who the message is *about*.
 *
 * Invariant: the transport (an ATS, an assessment platform, a job board, a scheduler, a free mailbox) is never the
 * employer. The classes below only decide whether a sender may supply the employer's name.
 */
export type SenderKind = "employer" | "ats" | "assessment" | "job_board" | "scheduler" | "freemail" | "unknown_vendor";

const ASSESSMENT = ["hackerrank.com", "hackerrankforwork.com", "codesignal.com", "codility.com", "hirevue.com", "karat.com", "coderpad.io", "theforage.com", "predictiveindex.com", "starred.com", "modernhire.com"];
const JOB_BOARD = ["linkedin.com", "indeed.com", "handshake.com", "joinhandshake.com", "wellfound.com", "ripplematching.com", "ripplematch.com", "careerhub.com", "interfolio.com"];
const SCHEDULER = ["calendly.com", "goodtime.io", "modernloop.io", "gem.com", "metaview.ai"];
const FREEMAIL = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com"];

const inList = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Classify a sender domain. `learnedVendors` are domains this mailbox itself showed to serve several employers. */
export function classifySender(domain: string, learnedVendors: ReadonlySet<string> = new Set()): SenderKind {
  if (!domain) return "freemail";
  if (inList(domain, FREEMAIL)) return "freemail";
  if (inList(domain, ASSESSMENT)) return "assessment";
  if (inList(domain, JOB_BOARD)) return "job_board";
  if (inList(domain, SCHEDULER)) return "scheduler";
  if (inList(domain, PLATFORM_DOMAINS)) return "ats";
  if ([...learnedVendors].some((d) => domain === d || domain.endsWith(`.${d}`))) return "unknown_vendor";
  return "employer";
}

/**
 * Brands of the intermediaries themselves (assessment, job-board, scheduling, meeting tools). A message that names
 * one of them is describing the channel, so the name is never the hiring organisation by text alone.
 */
const INTERMEDIARY_LISTS = [ASSESSMENT, JOB_BOARD, SCHEDULER];
const TOOL_BRANDS = ["zoom", "googlecalendar", "googlemeet", "microsoftteams", "teams", "calendly", "docusign", "greenhouse", "lever", "workday", "ashby", "icims", "smartrecruiters", "jobvite", "taleo", "handshake", "indeed"];
const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const INTERMEDIARY_KEYS = new Set<string>([
  ...TOOL_BRANDS,
  ...INTERMEDIARY_LISTS.flatMap((list) => list.map((d) => flat(d.split(".")[0]).replace(/^the/, "")).concat(list.map((d) => flat(d.split(".")[0])))),
]);
export const isIntermediaryBrand = (name: string) => INTERMEDIARY_KEYS.has(flat(name));

export const canSupplyEmployer = (kind: SenderKind) => kind === "employer";

/**
 * ATS tenant identifiers in links and addresses. A tenant slug names the employer even when the sender is the vendor.
 * Invariant: an identifier the vendor assigns to one employer identifies that employer.
 */
const TENANT_PATTERNS: Array<{ re: RegExp; group: number; label: string }> = [
  { re: /https?:\/\/(?:boards|job-boards|boards-api)\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9][a-z0-9-]{1,40})/gi, group: 1, label: "greenhouse-board" },
  { re: /https?:\/\/jobs\.lever\.co\/([a-z0-9][a-z0-9-]{1,40})/gi, group: 1, label: "lever-board" },
  { re: /https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9][a-z0-9.-]{1,40})/gi, group: 1, label: "ashby-board" },
  { re: /https?:\/\/([a-z0-9][a-z0-9-]{1,40})\.(?:wd\d+\.)?myworkdayjobs\.com/gi, group: 1, label: "workday-site" },
  { re: /https?:\/\/([a-z0-9][a-z0-9-]{1,40})\.applytojob\.com/gi, group: 1, label: "jazzhr-site" },
  { re: /https?:\/\/([a-z0-9][a-z0-9-]{1,40})\.(?:wd\d+\.)?myworkdaysite\.com/gi, group: 1, label: "workday-site" },
  { re: /https?:\/\/([a-z0-9][a-z0-9-]{1,40})\.icims\.com/gi, group: 1, label: "icims-site" },
  { re: /https?:\/\/([a-z0-9][a-z0-9-]{1,40})\.(?:jobs\.)?smartrecruiters\.com|https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9][a-z0-9-]{1,40})/gi, group: 1, label: "smartrecruiters" },
  { re: /https?:\/\/([a-z0-9][a-z0-9-]{1,40})\.(?:recruitee|breezy|teamtailor|workable)\.(?:com|hr)/gi, group: 1, label: "ats-site" },
];
const SHARED_TENANT_WORDS = new Set(["www", "jobs", "careers", "career", "apply", "app", "mail", "email", "click", "link", "us", "eu", "api", "my", "login", "candidate", "tracking", "track", "trk", "clicks", "links", "url", "urls", "notify", "notifications", "news", "images", "img", "static", "cdn", "assets", "help", "support", "status", "go", "hire", "hiring", "recruiting", "talent", "s", "e", "em", "wd1", "wd3", "wd5", "wd12", "boards", "embed", "external", "external-careers"]);

export function tenantsFromText(text: string): Array<{ slug: string; label: string }> {
  const found: Array<{ slug: string; label: string }> = [];
  for (const { re, group, label } of TENANT_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const slug = (m[group] ?? m[2] ?? "").toLowerCase();
      if (slug && !SHARED_TENANT_WORDS.has(slug) && !found.some((f) => f.slug === slug)) found.push({ slug, label });
    }
  }
  return found;
}

/** Workday addresses mail as <tenant>@myworkday.com. */
export function tenantFromAddress(from: string): string | null {
  const s = parseSender(from);
  if (/(^|\.)myworkday\.com$/.test(s.domain) && s.localPart && !/(no-?reply|donotreply|do-not-reply|workday|notifications?|system)/.test(s.localPart)) return s.localPart;
  return null;
}
