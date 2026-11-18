import { parseSender } from "../opportunities/normalize.ts";
import { looksLikePerson } from "../recruiting/company.ts";
import { collectEvidence } from "../recruiting/entity/resolve.ts";
import { classifySender, isIntermediaryBrand, type SenderKind } from "../recruiting/entity/vendors.ts";
import type { VerifiedReading } from "../semantic/reading.ts";
import { canonicalOrg, coreName, vendorOrgs, flat, isAmbiguousName, isTeamName, lookup, orgsAtDomain, registrable, type Org, type OrgKind } from "./graph.ts";
import type { LearnedMap } from "./learned.ts";

/**
 * Employer resolution: "which organization is the employer in this recruiting context?"
 *
 *   evidence (sender, subject, body, tenant, thread, known applications, learned mappings, semantic reading)
 *   -> organization candidates, normalized through the identity graph (team names stripped, aliases and brands folded)
 *   -> kinds ruled out (ATS, assessment, scheduler, job board, agency, person) and recorded as intermediaries
 *   -> independent-class scoring -> trust ladder: known | likely | review | unknown
 *
 * Evidence is combined across INDEPENDENT classes only (a vendor's template that stamps the same company into the display name and the subject is one
 * voice, and so are a body pattern and a semantic reading of the same sentence, unless two readers agree, which earns a small bonus).
 * Aggressive about generating candidates, conservative about promoting them: a name needs a second independent class to be Known when it is an
 * ordinary word, and nothing is Known on a single weak class.
 */
export type TrustState = "known" | "likely" | "review" | "unknown";
export type Intermediary = { name: string; kind: OrgKind | "recruiter" | "team" };
export type IdentityInput = {
  from: string;
  replyTo?: string;
  subject: string;
  body: string;
  /** Employers resolved for other messages in the same thread. */
  threadCompanies?: string[];
  /** Employers the user already has opportunities with (never creates a candidate by itself). */
  knownCompanies?: string[];
  learned?: LearnedMap;
  learnedVendors?: ReadonlySet<string>;
  /** The verified semantic reading of this message, when a second reader ran. */
  semantic?: VerifiedReading;
};
export type IdentityResult = {
  state: TrustState;
  employer: { name: string; id: string; org: Org | null } | null;
  /** Every candidate considered, best first (names and scores only), so callers can ask how well supported a particular name is. */
  candidates: Array<{ name: string; id: string; score: number }>;
  /** The runner-up when the state is "review". */
  alternative: { name: string; id: string } | null;
  score: number;
  classes: string[];
  intermediaries: Intermediary[];
  /** A department or function named in the message ("Everpure Recruiting"). */
  team: string | null;
  /** Plain reasons, never message text. */
  reasons: string[];
};

type Class = "owner" | "assertion" | "text" | "tenant" | "thread" | "known" | "learned" | "relationship";
const W = { ownerGraph: 0.8, ownerLabel: 0.5, ownerGeneric: 0.12, assertion: 0.6, via: 0.65, subject: 0.6, body: 0.3, tenant: 0.85, thread: 0.7, known: 0.4, learned: 0.92, relationship: 0.65, relationshipCache: 0.5, bothReaders: 0.1 } as const;
export const THRESHOLDS = { known: 0.8, likely: 0.4, conflict: 0.4, conflictGap: 0.25, ambiguousCap: 0.6 } as const;

const GENERIC_PART = /^(mail|e?mail|notify|notifications?|jobs?|careers?|hiring|hire|recruit\w*|talent|people|team|hello|info|support|example|news|updates?|no-?reply|apply|app|portal|link|click|my|us|eu|em|send|msg|bounce|smtp|mx)$/i;
/** A domain label made only of generic mail/jobs words ("jobs-notify", "example-mail") names a channel, not a company. */
export const isGenericLabel = (label: string) => label.split(/[-_.]/).filter(Boolean).every((p) => GENERIC_PART.test(p));

const KIND_OF_SENDER: Partial<Record<SenderKind, OrgKind>> = { ats: "ats", assessment: "assessment", scheduler: "scheduler", job_board: "job_board" };

/** Words that name a kind of message, not an organization ("Opportunity: Data Analyst Intern", "Your application"). */
const GENERIC_NOUN = /^(?:opportunit(?:y|ies)|applications?|updates?|interviews?|assessments?|offers?|roles?|positions?|jobs?|invitations?|invites?|challenges?|tests?|next steps?|congratulations|thank you|reminders?|messages?|follow[- ]?up|hello|hi|re|fwd|action required|important|care|services?|desk|center|centre|help|helpdesk|admin|system|alerts?|portal|recruiter|candidate)$/i;
/** Words that mark a staffing or search firm by what it is, so an agency the graph has never heard of is still not the employer. */
const AGENCY_WORD = /\b(?:staffing|executive search|search (?:firm|partners|group)|placement|workforce solutions|talent solutions|recruitment (?:agency|firm)|recruiting (?:agency|firm))\b/i;
/** A vendor's name followed only by generic channel words ("HackerRank Tests", "Greenhouse Notifications") is that vendor. */
const CHANNEL_TAIL = /^(?:tests?|assessments?|invites?|invitations?|notifications?|support|team|mail|alerts?|platform|jobs|candidates?)$/i;
function vendorWithTail(core: string): Org | null {
  const words = core.split(/\s+/);
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const hit = lookup(words.slice(0, n).join(" "));
    if (hit && hit.kind !== "employer" && words.slice(n).every((w) => CHANNEL_TAIL.test(w))) return hit;
  }
  return null;
}

/** True when the name extends an ATS/assessment/job-board/agency name ("Handshake AI"): possibly a division of the vendor, possibly another company. */
export function extendsVendor(name: string): boolean {
  if (VENDOR_IDS.length === 0) for (const o of vendorOrgs()) if (o.id.length >= 4) VENDOR_IDS.push(o.id);
  const k = flat(coreName(name));
  return VENDOR_IDS.some((v) => k.length > v.length && k.startsWith(v));
}

/** Why a name cannot be the employer, if it cannot: a message kind, a department word, a staffing firm, or a vendor. Used to veto the rule reader's own guess too. */
export function notEmployerReason(name: string): "generic" | "agency" | OrgKind | null {
  const core = coreName(name);
  if (core.length < 2 || GENERIC_NOUN.test(core)) return "generic";
  if (AGENCY_WORD.test(name)) return "agency";
  const hit = lookup(core) ?? vendorWithTail(core);
  if (hit && hit.kind !== "employer") return hit.kind;
  if (isIntermediaryBrand(core)) return "ats";
  return null;
}

const LAST_FIRST = /^[A-Z][A-Za-z'’-]+,\s*[A-Z][A-Za-z'’-]+(?:\s+[A-Z]\.?)?$/;

const VENDOR_IDS: string[] = [];
type Cand = { id: string; name: string; org: Org | null; best: Map<Class, number>; sources: Set<string>; team: string | null };

export function resolveIdentity(input: IdentityInput): IdentityResult {
  if (VENDOR_IDS.length === 0) for (const o of vendorOrgs()) if (o.id.length >= 4) VENDOR_IDS.push(o.id);
  const sender = parseSender(input.from);
  const senderKind = classifySender(sender.domain, input.learnedVendors);
  const senderOrgs = orgsAtDomain(sender.domain);
  const senderIsVendor = senderKind !== "employer" || senderOrgs.some((o) => o.kind !== "employer");
  const reasons: string[] = [];
  const intermediaries: Intermediary[] = [];
  const noteIntermediary = (name: string, kind: Intermediary["kind"]) => { if (!intermediaries.some((i) => flat(i.name) === flat(name))) intermediaries.push({ name, kind }); };

  // The sending platform itself is an intermediary, named by its graph record or its domain.
  const senderVendor = senderOrgs.find((o) => o.kind !== "employer");
  if (senderVendor) noteIntermediary(senderVendor.name, senderVendor.kind);
  else if (KIND_OF_SENDER[senderKind]) noteIntermediary(coreName(sender.domain.split(".").slice(-2, -1)[0] ?? sender.domain), KIND_OF_SENDER[senderKind]!);

  const cands = new Map<string, Cand>();
  const exclude = new Set<string>();
  const vote = (rawName0: string, cls: Class, weight: number, source: string) => {
    // "Dana Reyes at Robert Half": the person is the recruiter, the organization is what follows
    // "Fry, Alan R" and "Alan R Fry" are people; so is anything looksLikePerson says is
    if (LAST_FIRST.test(rawName0.trim())) { noteIntermediary(rawName0.trim(), "recruiter"); return; }
    const at = rawName0.match(/^(.+?)\s+(?:at|from|of|@)\s+(.+)$/i);
    const rawName = at && looksLikePerson(at[1].trim()) ? at[2].trim() : rawName0;
    if (at && rawName !== rawName0) noteIntermediary(at[1].trim(), "recruiter");
    const core = coreName(rawName);
    if (core.length < 2 || (looksLikePerson(core) && !/\b(?:labs?|inc|corp|llc|ltd)\b/i.test(rawName))) return;
    if (GENERIC_NOUN.test(core)) return;
    if (AGENCY_WORD.test(rawName)) { noteIntermediary(core, "agency"); exclude.add(flat(core)); return; }
    const hit = lookup(core) ?? vendorWithTail(core);
    if (hit && hit.kind !== "employer") { noteIntermediary(hit.name, hit.kind); exclude.add(hit.id); return; }
    if (isIntermediaryBrand(core)) { noteIntermediary(core, "ats"); return; }
    const org = hit ? canonicalOrg(hit) : null;
    const id = org?.id ?? flat(core);
    const name = org?.name ?? core;
    const c = cands.get(id) ?? { id, name, org, best: new Map(), sources: new Set(), team: null };
    c.best.set(cls, Math.max(c.best.get(cls) ?? 0, weight));
    c.sources.add(source);
    if (isTeamName(rawName)) c.team = rawName.trim();
    if (org && !c.org) c.org = org;
    cands.set(id, c);
  };

  // 1. the rule reader's own evidence, folded through the graph
  const { evidence, recruiter } = collectEvidence({ from: input.from, replyTo: input.replyTo, subject: input.subject, body: input.body, threadCompanies: input.threadCompanies, learnedVendors: input.learnedVendors });
  for (const e of evidence) {
    switch (e.source) {
      case "sender_domain":
      case "reply_to_domain": {
        const dom = e.detail.replace(/^(domain|reply-to) /, "");
        const candHit = lookup(coreName(e.name));
        const candId = (candHit ? canonicalOrg(candHit).id : null) ?? flat(coreName(e.name));
        const owned = orgsAtDomain(dom).some((o) => o.kind === "employer" && (o.id === candId || canonicalOrg(o).id === candId));
        const label = registrable(dom).split(".")[0] ?? "";
        vote(e.name, "owner", owned ? W.ownerGraph : isGenericLabel(label) ? W.ownerGeneric : W.ownerLabel, "sender domain");
        break;
      }
      // a vendor's template stamps the same company into display name and subject: one voice
      case "display_name": vote(e.name, "assertion", e.detail.includes("via") ? W.via : senderIsVendor ? W.assertion : 0.4, "display name"); break;
      case "subject": vote(e.name, senderIsVendor ? "assertion" : "text", W.subject, "subject"); break;
      case "body": vote(e.name, "text", W.body, "body"); break;
      case "ats_tenant": vote(e.name, "tenant", e.weight, "ATS tenant"); break;
      case "thread": vote(e.name, "thread", W.thread, "same thread"); break;
      default: break;
    }
  }
  for (const c of input.threadCompanies ?? []) vote(c, "thread", W.thread, "same thread");

  // 2. the semantic reading: its typed entities rule intermediaries out, its verified employer is relationship evidence
  const sem = input.semantic;
  if (sem && sem.output.status === "ok" && sem.output.certainty !== "low") {
    for (const e of sem.entities) {
      if (e.kind === "employer" || e.kind === "other" || e.kind === "recruiter") continue;
      const hit = lookup(coreName(e.name));
      if (!hit || hit.kind === "employer") { exclude.add(flat(coreName(e.name))); noteIntermediary(e.name, ({ recruiting_agency: "agency", ats_vendor: "ats", assessment_vendor: "assessment" } as Record<string, OrgKind>)[e.kind] ?? (e.kind as OrgKind)); }
    }
    if (sem.employer) vote(sem.employer.name, "relationship", sem.output.certainty === "high" ? W.relationship : W.relationshipCache, "semantic relationship");
  }

  // 3. the user's own confirmed mappings (learned.ts guards against poisoning)
  const learned = input.learned;
  if (learned) {
    const byDomain = !senderIsVendor ? learned.byDomain.get(registrable(sender.domain)) : undefined;
    if (byDomain) vote(byDomain, "learned", W.learned, "your earlier confirmation");
    const display = coreName(input.from.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim());
    const byDisplay = display && !looksLikePerson(display) ? learned.byDisplay.get(flat(display)) : undefined;
    if (byDisplay) vote(byDisplay, "learned", W.learned, "your earlier confirmation");
  }

  // 4. a previously established application raises belief in a candidate the message already suggests; it never creates one
  const known = new Set((input.knownCompanies ?? []).map((c) => flat(coreName(c))));
  for (const c of cands.values()) if (known.has(flat(coreName(c.name)))) c.best.set("known", W.known);

  // 5. score
  // a candidate that merely extends an intermediary's name ("12twenty for Employers", "HackerRank Tests") is that intermediary
  const channelKeys = intermediaries.filter((i) => i.kind !== "recruiter" && i.kind !== "team").map((i) => flat(i.name)).filter((k) => k.length >= 4);
  const scored = [...cands.values()].filter((c) => !exclude.has(c.id) && !channelKeys.some((k) => c.id.startsWith(k))).map((c) => {
    let miss = 1;
    for (const w of c.best.values()) miss *= 1 - w;
    let score = 1 - miss;
    // two readers (rules and semantic) reading the same prose and agreeing is worth a little more than either, not a full independent vote
    if (c.best.has("relationship") && c.best.has("text")) score = Math.min(0.99, Math.max(c.best.get("relationship")!, c.best.get("text")!) + W.bothReaders);
    const classes = [...c.best.keys()];
    const ambiguous = (c.org?.ambiguous ?? isAmbiguousName(c.name)) && classes.length < 2;
    if (ambiguous) score = Math.min(score, c.id.length <= 3 ? THRESHOLDS.likely - 0.05 : THRESHOLDS.ambiguousCap);
    // a name that extends a vendor's ("Handshake AI") may be a division of the vendor or a different company: never Known on its own
    if (VENDOR_IDS.some((v) => c.id.length > v.length && c.id.startsWith(v))) score = Math.min(score, THRESHOLDS.known - 0.05);
    return { c, score, classes, ambiguous };
  }).sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));

  const cand = scored.map((s) => ({ name: s.c.name, id: s.c.id, score: Number(s.score.toFixed(3)) }));
  const team = scored.find((s) => s.c.team)?.c.team ?? null;
  if (recruiter) noteIntermediary(recruiter, "recruiter");
  const channels = intermediaries.filter((i) => i.kind !== "recruiter" && i.kind !== "team").map((i) => i.name);
  if (senderIsVendor && channels.length > 0) reasons.push(`sent through ${channels.join(", ")}, which is not the employer`);

  const top = scored[0];
  if (!top || top.score < THRESHOLDS.likely) {
    if (top) reasons.push("not enough independent evidence for a company");
    return { state: "unknown", employer: null, alternative: null, candidates: cand, score: top?.score ?? 0, classes: top?.classes ?? [], intermediaries, team, reasons };
  }
  const sameFamily = (a: Cand, b: Cand) => (a.org?.parent && flat(a.org.parent) === b.id) || (b.org?.parent && flat(b.org.parent) === a.id);
  const second = scored.find((s) => s !== top && s.score >= THRESHOLDS.conflict && !sameFamily(top.c, s.c));
  const employer = { name: top.c.name, id: top.c.id, org: top.c.org };
  if (second && top.score - second.score < THRESHOLDS.conflictGap) {
    reasons.push(`plausibly ${top.c.name} or ${second.c.name}`);
    return { state: "review", employer, alternative: { name: second.c.name, id: second.c.id }, candidates: cand, score: top.score, classes: top.classes, intermediaries, team, reasons };
  }
  const strongClass = top.classes.some((k) => k === "learned" || k === "thread" || k === "tenant" || k === "relationship") || (top.c.best.get("owner") ?? 0) >= W.ownerGraph;
  const isKnown = top.score >= THRESHOLDS.known && (top.classes.length >= 2 || strongClass) && !top.ambiguous;
  if (!isKnown) reasons.push(top.ambiguous ? `"${top.c.name}" is also an ordinary word: more than one signal is needed` : "the evidence is strong but not decisive");
  return { state: isKnown ? "known" : "likely", employer, alternative: null, candidates: cand, score: top.score, classes: top.classes, intermediaries, team, reasons };
}
