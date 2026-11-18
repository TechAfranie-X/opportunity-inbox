import { WIKIDATA_ORGS } from "./seed.generated.ts";
import { LOGOS } from "./logos.ts";

/**
 * The company identity graph: a PRIOR, not ground truth. It answers "what canonical entity does this name or domain refer to, and what kind of
 * organization is it?". It is layered from sources that need no paid service and no network at run time:
 *   1. public Wikidata (CC0): ~17k companies with official websites, aliases by name form, and parent organizations (seed.generated.ts, built once);
 *   2. a small curated layer for what recruiting mail is full of and Wikidata does not model: ATS, assessment, scheduling and job-board vendors, and
 *      staffing agencies, plus brands that recruit through their parent;
 *   3. the bundled brand marks (logos.ts), which also name well-known employers;
 *   4. the user's own confirmed mappings, learned locally (learned.ts), applied by the resolver, never written here.
 * Coverage is partial by design: a name the graph does not know is not rejected, it simply gets no help from the prior.
 */
export type OrgKind = "employer" | "agency" | "ats" | "assessment" | "scheduler" | "job_board";
export type Org = {
  id: string;
  name: string;
  kind: OrgKind;
  domains: string[];
  /** Parent organization's name, when known. */
  parent?: string;
  /** "parent": this brand recruits under its parent's name (AWS recruits as Amazon). "self": it is its own employer for a candidate (LinkedIn, GitHub, DeepMind). */
  recruitsAs: "self" | "parent";
  /** The name is an ordinary word or very short (Scale, Toast, X, Ramp): it needs more than one independent signal before it is trusted. */
  ambiguous: boolean;
  source: "wikidata" | "curated" | "brand";
};

export const flat = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

const SUFFIX = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|holdings?|group|technologies|technology|the)\b\.?/gi;
/** Words that describe a department or function of an organization rather than the organization: "Everpure Recruiting", "Meta University Recruiting". */
const FUNCTION_WORDS = /\b(university|campus|early careers?|new grads?|new graduates?|students?|interns?|internships?|recruiting|recruitment|recruiters?|careers?|talent|acquisition|people|hiring|human resources|hr|jobs|team|teams|operations|programs?|candidates?|notifications?|no-?reply|noreply|do-?not-?reply|support|updates?)\b/gi;

/** "Meta University Recruiting" -> "Meta"; "Jane Street Campus Recruiting" -> "Jane Street"; "Acme, Inc." -> "Acme". Empty when nothing but function words remain. */
export function coreName(raw: string): string {
  return raw.replace(/&amp;/g, "&").replace(FUNCTION_WORDS, " ").replace(SUFFIX, " ").replace(/[,|:;()\-–—]+/g, " ").replace(/\s+/g, " ").trim();
}
/** True when stripping function words changed the name, i.e. the string names a team or function of the organization. */
export const isTeamName = (raw: string) => coreName(raw).toLowerCase() !== raw.replace(SUFFIX, " ").replace(/[,|:;()\-–—]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const SECOND = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
export function registrable(host: string): string {
  const p = host.toLowerCase().replace(/^www\d?\./, "").split(".");
  if (p.length >= 3 && SECOND.has(p[p.length - 2]) && p[p.length - 1].length === 2) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}

type Curated = [name: string, kind: OrgKind, domains: string[], extra?: { parent?: string; recruitsAs?: "parent" }];
const CURATED: Curated[] = [
  // applicant tracking systems
  ["Greenhouse", "ats", ["greenhouse.io", "greenhouse-mail.io"]], ["Lever", "ats", ["lever.co"]], ["Workday", "ats", ["myworkday.com", "myworkdayjobs.com", "workday.com"]],
  ["Ashby", "ats", ["ashbyhq.com"]], ["SmartRecruiters", "ats", ["smartrecruiters.com"]], ["iCIMS", "ats", ["icims.com"]], ["Taleo", "ats", ["taleo.net"]],
  ["Jobvite", "ats", ["jobvite.com"]], ["BambooHR", "ats", ["bamboohr.com"]], ["Workable", "ats", ["workable.com"]], ["Recruitee", "ats", ["recruitee.com"]],
  ["Teamtailor", "ats", ["teamtailor.com"]], ["JazzHR", "ats", ["applytojob.com", "jazzhr.com"]], ["Breezy", "ats", ["breezy.hr"]], ["Pinpoint", "ats", ["pinpointhq.com"]],
  // assessment vendors
  ["HackerRank", "assessment", ["hackerrank.com", "hackerrankforwork.com"]], ["CodeSignal", "assessment", ["codesignal.com"]], ["Codility", "assessment", ["codility.com"]],
  ["HireVue", "assessment", ["hirevue.com"]], ["Karat", "assessment", ["karat.com"]], ["CoderPad", "assessment", ["coderpad.io"]], ["Pymetrics", "assessment", ["pymetrics.ai", "pymetrics.com"]],
  ["Criteria", "assessment", ["criteriacorp.com"]], ["TestGorilla", "assessment", ["testgorilla.com"]], ["SHL", "assessment", ["shl.com"]], ["Mettl", "assessment", ["mettl.com"]],
  ["Vervoe", "assessment", ["vervoe.com"]], ["Harver", "assessment", ["harver.com"]], ["Plum", "assessment", ["plum.io"]],
  // schedulers
  ["Calendly", "scheduler", ["calendly.com"]], ["GoodTime", "scheduler", ["goodtime.io"]], ["ModernLoop", "scheduler", ["modernloop.io"]], ["Gem", "scheduler", ["gem.com"]], ["Metaview", "scheduler", ["metaview.ai"]],
  // job boards and campus platforms
  ["LinkedIn", "job_board", ["linkedin.com"]], ["Indeed", "job_board", ["indeed.com"]], ["Handshake", "job_board", ["joinhandshake.com", "handshake.com"]], ["Glassdoor", "job_board", ["glassdoor.com"]],
  ["ZipRecruiter", "job_board", ["ziprecruiter.com"]], ["Wellfound", "job_board", ["wellfound.com", "angel.co"]], ["RippleMatch", "job_board", ["ripplematch.com", "ripplematching.com"]],
  ["Simplify", "job_board", ["simplify.jobs"]], ["Y Combinator Work at a Startup", "job_board", ["workatastartup.com"]],
  // staffing and recruiting agencies
  ["Robert Half", "agency", ["roberthalf.com"]], ["Randstad", "agency", ["randstad.com", "randstadusa.com"]], ["Adecco", "agency", ["adecco.com", "adeccousa.com"]],
  ["Kforce", "agency", ["kforce.com"]], ["Insight Global", "agency", ["insightglobal.com"]], ["TEKsystems", "agency", ["teksystems.com"]], ["Aerotek", "agency", ["aerotek.com"]],
  ["ManpowerGroup", "agency", ["manpowergroup.com", "manpower.com"]], ["Hays", "agency", ["hays.com"]], ["Kelly Services", "agency", ["kellyservices.com"]], ["Apex Systems", "agency", ["apexsystems.com"]],
  ["Experis", "agency", ["experis.com"]], ["Robert Walters", "agency", ["robertwalters.com"]], ["Michael Page", "agency", ["michaelpage.com"]], ["Collabera", "agency", ["collabera.com"]],
  ["Judge Group", "agency", ["judge.com"]], ["Beacon Hill", "agency", ["beaconhillstaffing.com"]], ["Jobot", "agency", ["jobot.com"]], ["Lucas Group", "agency", ["lucasgroup.com"]],
  // brands that recruit through their parent
  ["Amazon Web Services", "employer", ["aws.amazon.com", "amazon.jobs"], { parent: "Amazon", recruitsAs: "parent" }],
  ["AWS", "employer", [], { parent: "Amazon", recruitsAs: "parent" }],
  ["Meta Platforms", "employer", ["meta.com"], { parent: "Meta", recruitsAs: "parent" }],
  ["Facebook", "employer", [], { parent: "Meta", recruitsAs: "parent" }],
  ["Google Cloud", "employer", ["cloud.google.com"], { parent: "Google", recruitsAs: "parent" }],
  ["YouTube", "employer", [], { parent: "Google", recruitsAs: "parent" }],
  ["Alphabet", "employer", ["abc.xyz"], { parent: "Google", recruitsAs: "parent" }],
];

export { isAmbiguousName } from "./names.ts";
import { isAmbiguousName } from "./names.ts";

const orgs: Org[] = [];
const byKey = new Map<string, Org[]>();
const byDomain = new Map<string, Org[]>();
const byId = new Map<string, Org>();

function add(o: Org) {
  const existing = byId.get(o.id);
  if (existing) {
    // a curated or brand record refines a Wikidata one: kind and recruitsAs win, domains merge
    if (o.source === "curated") { existing.kind = o.kind; existing.recruitsAs = o.recruitsAs; existing.parent = o.parent ?? existing.parent; existing.source = "curated"; }
    for (const d of o.domains) if (!existing.domains.includes(d)) { existing.domains.push(d); (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(existing); }
    return;
  }
  orgs.push(o);
  byId.set(o.id, o);
  for (const k of new Set([flat(o.name), flat(coreName(o.name))])) if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(o);
  for (const d of o.domains) (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(o);
}

for (const [name, domains, parent, amb] of WIKIDATA_ORGS) {
  add({ id: flat(coreName(name)) || flat(name), name: coreName(name) || name, kind: "employer", domains, parent: parent || undefined, recruitsAs: "self", ambiguous: amb === 1 || isAmbiguousName(coreName(name) || name), source: "wikidata" });
}
for (const l of Object.values(LOGOS)) add({ id: flat(l.name), name: l.name, kind: "employer", domains: [], recruitsAs: "self", ambiguous: isAmbiguousName(l.name), source: "brand" });
for (const [name, kind, domains, extra] of CURATED) add({ id: flat(name), name, kind, domains, parent: extra?.parent, recruitsAs: extra?.recruitsAs ?? "self", ambiguous: isAmbiguousName(name), source: "curated" });

export const graphSize = () => orgs.length;
export const orgsNamed = (name: string): Org[] => byKey.get(flat(coreName(name)) || flat(name)) ?? [];
export const orgsAtDomain = (host: string): Org[] => byDomain.get(registrable(host)) ?? [];

/** The entity a candidate resolves to for recruiting purposes: a brand that recruits under its parent resolves to the parent. */
export function canonicalOrg(o: Org): Org {
  if (o.recruitsAs === "parent" && o.parent) return orgsNamed(o.parent).find((p) => p.kind === "employer") ?? { ...o, id: flat(o.parent), name: o.parent, recruitsAs: "self" };
  return o;
}

/** Best graph record for a name: prefers a vendor/agency record (a name that is both is judged by the evidence, not here), else the first employer. */
export function lookup(name: string): Org | null {
  const hits = orgsNamed(name);
  return hits.find((h) => h.kind !== "employer") ?? hits[0] ?? null;
}

/** Curated ATS, assessment, scheduler, job-board and agency records. */
export const vendorOrgs = (): Org[] => orgs.filter((o) => o.kind !== "employer");
