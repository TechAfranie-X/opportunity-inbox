import { parseSender } from "../../opportunities/normalize.ts";
import { companyFromDisplayName, companyFromText, expandOrganization, looksLikePerson, recoverBrandName, registrableLabel } from "../company.ts";
import { canonicalBrand, flatKey } from "./aliases.ts";
import { canSupplyEmployer, classifySender, isIntermediaryBrand, tenantFromAddress, tenantsFromText, type SenderKind } from "./vendors.ts";

/**
 * Company (employer) resolution as evidence, not as a string guess.
 *
 * Every source of evidence is collected separately, scored by how independent corroboration accumulates, and
 * reported with the signals that produced it, so a wrong answer can be diagnosed and a doubtful one withheld.
 *
 * Invariants this subsystem encodes (each has a test):
 *  I1  The transport is not the subject: a vendor or free-mail sender never supplies the employer by itself.
 *  I2  An identifier a vendor assigns to one employer (an ATS tenant) identifies that employer.
 *  I3  Confidence needs independent corroboration: one weak source is not enough to assert an employer.
 *  I4  Disagreement lowers confidence and is surfaced as an alternative, never resolved silently.
 *  I5  An employer domain maps to one employer: a domain seen serving several employers is a vendor.
 *  I6  A person's name is the recruiter, not the company.
 *  I7  A domain is an identity key, not a name: when the message names an organisation the domain abbreviates or is a unit of,
 *      that fuller name is the answer. Without such a name the domain still supports its own brand, nothing more.
 *  I8  Independent corroboration includes the message naming the candidate: a name the sender block asserts and the text
 *      never mentions is weaker than one the text confirms (this is what separates "sent by a vendor on behalf of X").
 *  I9  The intermediary's own brand (assessment platform, job board, scheduler, meeting tool) is never the hiring organisation
 *      by text alone.
 *  I10 A descriptor attached to a name already confirmed by the sender ("Alcon" + "'s Innovate Boldly Externship") is the name
 *      of a programme, not part of the employer.
 *  I11 An identifier a vendor assigns is only as good as its being a name: infrastructure hostnames exist for every customer,
 *      and a slug the message never mentions is weaker than one it does.
 */

export type EvidenceSource = "sender_domain" | "display_name" | "reply_to_domain" | "subject" | "body" | "ats_tenant" | "thread" | "context";

export type Evidence = { source: EvidenceSource; name: string; key: string; weight: number; detail: string };

export type ResolverConfig = {
  /** Weight of one piece of evidence, by source. Combined across *independent* sources only. */
  weights: Record<EvidenceSource, number>;
  /** Below this confidence the employer is withheld (reported unknown). */
  unknownBelow: number;
  /** Below this the employer is shown but flagged for review. */
  reviewBelow: number;
  /** How much a competing candidate subtracts from the leader's confidence. */
  conflictPenalty: number;
  /** Added when the candidate is also a company the user already has an opportunity with. */
  contextBonus: number;
};

export const DEFAULT_RESOLVER_CONFIG: ResolverConfig = {
  weights: { sender_domain: 0.55, display_name: 0.4, reply_to_domain: 0.4, subject: 0.6, body: 0.3, ats_tenant: 0.85, thread: 0.5, context: 0 },
  unknownBelow: 0.35,
  reviewBelow: 0.6,
  conflictPenalty: 0.5,
  contextBonus: 0.1,
};

export type ResolveInput = {
  from: string;
  replyTo?: string;
  subject: string;
  /** Message text, held in memory only. */
  body: string;
  /** Employers already resolved for other messages in the same thread. */
  threadCompanies?: string[];
  /** Employers the user already has opportunities with. Raises belief in a matching candidate; never creates one. */
  knownCompanies?: string[];
  /** Domains the mailbox itself showed to serve several employers (invariant I5). */
  learnedVendors?: ReadonlySet<string>;
};

export type CompanyResolution = {
  entity: { name: string; key: string } | null;
  confidence: number;
  evidence: Evidence[];
  alternatives: Array<{ name: string; key: string; score: number }>;
  senderKind: SenderKind;
  /** A person-like sender name seen and deliberately not used as the company (I6). */
  recruiter: string | null;
  reviewRequired: boolean;
  reasons: string[];
};

const key = (name: string) => flatKey(canonicalBrand(name));
const FAMILY: Record<EvidenceSource, string> = { sender_domain: "sender", display_name: "sender", reply_to_domain: "reply", subject: "text", body: "text", ats_tenant: "tenant", thread: "thread", context: "context" };

function candidateFromDomainLabel(domain: string, text: string) {
  const expanded = expandOrganization(domain, text); // I7
  if (expanded) return canonicalBrand(expanded);
  const label = registrableLabel(domain);
  if (!label) return null;
  return canonicalBrand(recoverBrandName(label, text));
}

/** Programme descriptors that follow an employer's name (I10). */
const PROGRAM_TAIL = /\b(?:program(?:me)?|externship|internship|fellowship|apprenticeship|academy|scholars?|challenge|initiative|experience|institute|summit|fest|week)\b/i;
const possessiveTail = (tail: string) => /^[’']s\b/.test(tail) || PROGRAM_TAIL.test(tail) || tail.trim().split(/\s+/).length >= 3;
const withoutAddresses = (text: string) => text.replace(/https?:\/\/\S+/g, " ").replace(/\S+@\S+/g, " ");
const mentions = (name: string, text: string) => new RegExp(`(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(text);

export function collectEvidence(input: ResolveInput, cfg: ResolverConfig = DEFAULT_RESOLVER_CONFIG) {
  const w = cfg.weights;
  const sender = parseSender(input.from);
  const senderKind = classifySender(sender.domain, input.learnedVendors);
  const body = input.body.slice(0, 2500);
  const text = `${input.subject}\n${body}`;
  const evidence: Evidence[] = [];
  const add = (source: EvidenceSource, name: string | null, weight: number, detail: string) => {
    if (!name) return;
    const canonical = canonicalBrand(name.trim());
    if (canonical.length < 2) return;
    if (source !== "ats_tenant" && isIntermediaryBrand(canonical)) return; // I9
    evidence.push({ source, name: canonical, key: flatKey(canonical), weight, detail });
  };
  let recruiter: string | null = null;

  // I1: only an employer-class sender may supply the name from its own domain.
  if (canSupplyEmployer(senderKind)) add("sender_domain", candidateFromDomainLabel(sender.domain, text), w.sender_domain, `domain ${sender.domain}`);

  // Display name: "Acme via Greenhouse" and "Acme Recruiting" name the company; "Julia Ngo" names a person (I6).
  const via = /^\s*"?(.+?)"?\s+via\s+\S+/i.exec(input.from.replace(/<[^>]+>/g, ""));
  const display = companyFromDisplayName(input.from);
  const isPerson = (name: string) => looksLikePerson(name) && !/\b(?:corp|corporation|inc|llc|ltd|co|company|group|labs?)\b/i.test(name);
  if (via) {
    const originator = via[1].trim();
    if (isPerson(originator)) recruiter = originator;
    else add("display_name", originator, Math.min(0.7, w.display_name + 0.2), 'display name "X via Y"');
  } else if (display && isPerson(display)) recruiter = display;
  else if (display) add("display_name", display, w.display_name, "sender display name");

  // Reply-To: a company domain here is a strong hint even when the sender is a vendor.
  if (input.replyTo) {
    const reply = parseSender(input.replyTo);
    if (canSupplyEmployer(classifySender(reply.domain, input.learnedVendors)) && reply.domain !== sender.domain) {
      add("reply_to_domain", candidateFromDomainLabel(reply.domain, text), w.reply_to_domain, `reply-to ${reply.domain}`);
    }
  }

  // Content: subject first (more reliable), body only as weaker corroboration.
  add("subject", companyFromText(input.subject), w.subject, "subject pattern");
  add("body", companyFromText("", body), w.body, "body pattern");

  // I2: vendor tenant identifiers.
  // I11: a slug the message never mentions is weaker than one it does.
  const flatText = flatKey(withoutAddresses(text));
  const tenantWeight = (slug: string) => (flatText.includes(flatKey(slug)) ? w.ats_tenant : Math.min(w.ats_tenant, 0.5));
  const tenantAddr = tenantFromAddress(input.from);
  if (tenantAddr) add("ats_tenant", recoverBrandName(tenantAddr, text), tenantWeight(tenantAddr), "workday tenant address");
  for (const t of tenantsFromText(`${input.from}\n${input.replyTo ?? ""}\n${body}`).slice(0, 2)) add("ats_tenant", recoverBrandName(t.slug, text), tenantWeight(t.slug), `${t.label} link`);

  for (const c of input.threadCompanies ?? []) add("thread", c, w.thread, "same thread");

  // I8: a name the sender block asserts is corroborated when the message itself names it (links and addresses do not count).
  const prose = withoutAddresses(text);
  const proseSubject = withoutAddresses(input.subject);
  const asserted = new Map<string, Evidence>();
  for (const e of evidence) if (e.source === "sender_domain" || e.source === "display_name" || e.source === "reply_to_domain") asserted.set(e.key, e);
  for (const e of asserted.values()) {
    if (e.name.length < 3) continue;
    if (mentions(e.name, proseSubject)) add("subject", e.name, w.subject, "named in subject");
    else if (mentions(e.name, prose)) add("body", e.name, w.body, "named in message");
  }
  return { evidence, senderKind, recruiter };
}

/** Combine evidence: noisy-or across *independent* families, one vote per source family per candidate. */
export function resolveCompany(input: ResolveInput, cfg: ResolverConfig = DEFAULT_RESOLVER_CONFIG): CompanyResolution {
  const { evidence, senderKind, recruiter } = collectEvidence(input, cfg);
  const known = new Set((input.knownCompanies ?? []).map(key));

  type Cand = { name: string; best: Map<string, number>; items: Evidence[] };
  const byKey = new Map<string, Cand>();
  for (const e of evidence) {
    const k = key(e.name);
    const c: Cand = byKey.get(k) ?? { name: e.name, best: new Map<string, number>(), items: [] };
    // within a family only the strongest source counts, so a subject and a body that quote the same sentence are one voice
    const fam = FAMILY[e.source];
    c.best.set(fam, Math.max(c.best.get(fam) ?? 0, e.weight));
    c.items.push(e);
    byKey.set(k, c);
  }

  // I10: "Alcon's Innovate Boldly Externship" next to a sender-confirmed "Alcon" is a programme of Alcon.
  const confirmed = [...byKey.values()].filter((c) => c.best.has("sender")).sort((a, b) => b.name.length - a.name.length);
  for (const [k, c] of [...byKey.entries()]) {
    const base = confirmed.find((a) => a !== c && c.name.toLowerCase().startsWith(a.name.toLowerCase()) && c.name.length > a.name.length && possessiveTail(c.name.slice(a.name.length)));
    if (!base) continue;
    for (const [fam, wt] of c.best) base.best.set(fam, Math.max(base.best.get(fam) ?? 0, wt));
    base.items.push(...c.items);
    byKey.delete(k);
  }

  const scored = [...byKey.entries()].map(([k, c]) => {
    let miss = 1;
    for (const wt of c.best.values()) miss *= 1 - wt;
    let score = 1 - miss;
    if (known.has(k)) score = Math.min(1, score + cfg.contextBonus);
    // prefer the properly spelled name from the strongest source
    const strongest = [...c.items].sort((a, b) => b.weight - a.weight)[0];
    return { key: k, name: strongest.name, score };
  }).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const reasons: string[] = [];
  const top = scored[0];
  const second = scored[1];
  if (senderKind !== "employer") reasons.push(`sender is ${senderKind}: not used as the employer`);
  if (recruiter) reasons.push(`"${recruiter}" looks like a recruiter, not a company`);
  if (!top) {
    reasons.push("no employer evidence");
    return { entity: null, confidence: 0, evidence, alternatives: [], senderKind, recruiter, reviewRequired: true, reasons };
  }

  const confidence = Math.max(0, top.score - (second ? cfg.conflictPenalty * second.score : 0));
  if (second) reasons.push(`conflicting candidate "${second.name}" (${second.score.toFixed(2)})`);
  const independent = new Set(byKey.get(top.key)!.best.keys()).size;
  if (independent < 2 && top.score < cfg.reviewBelow) reasons.push("single weak source");

  const withheld = confidence < cfg.unknownBelow;
  return {
    entity: withheld ? null : { name: top.name, key: top.key },
    confidence: Number(confidence.toFixed(3)),
    evidence,
    alternatives: scored.slice(withheld ? 0 : 1, 4).map((s) => ({ name: s.name, key: s.key, score: Number(s.score.toFixed(3)) })),
    senderKind,
    recruiter,
    reviewRequired: withheld || confidence < cfg.reviewBelow,
    reasons,
  };
}

/** I5: domains that sent mail resolving to two or more distinct employers are vendors, not employers. */
export function inferVendorDomains(resolved: Array<{ domain: string; companyKey: string | null }>, minDistinct = 2): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const r of resolved) {
    if (!r.domain || !r.companyKey) continue;
    const set = seen.get(r.domain) ?? new Set();
    set.add(r.companyKey);
    seen.set(r.domain, set);
  }
  return new Set([...seen].filter(([, set]) => set.size >= minDistinct).map(([d]) => d));
}

export type BatchItem = ResolveInput & { id: string; threadId: string };

/**
 * Resolve a whole batch in two passes so cross-message evidence is usable:
 *  1. each message on its own; learn which sender domains are really vendors (I5);
 *  2. re-resolve with that knowledge and with the employers found in the same thread.
 */
export function resolveBatch(items: BatchItem[], cfg: ResolverConfig = DEFAULT_RESOLVER_CONFIG, knownCompanies: string[] = []): Map<string, CompanyResolution> {
  const first = new Map(items.map((it) => [it.id, resolveCompany({ ...it, knownCompanies }, cfg)]));
  // Learn vendors from what the CONTENT says (subject, tenant, "X via Y"), not from the final answer, which the vendor's own
  // domain would otherwise drag into conflict and withhold.
  const contentKey = (res: CompanyResolution) => {
    const e = [...res.evidence].filter((x) => (x.source === "subject" || x.source === "ats_tenant" || x.source === "display_name") && x.weight >= 0.5 && x.detail !== "named in subject").sort((a, b) => b.weight - a.weight)[0];
    return e ? e.key : null;
  };
  const learned = inferVendorDomains(items.map((it) => ({ domain: parseSender(it.from).domain, companyKey: contentKey(first.get(it.id)!) })));
  // Employers confidently found in a message's thread-mates (never the message itself) are evidence for it.
  const confident = new Map<string, Array<{ id: string; name: string }>>();
  for (const it of items) {
    const r = first.get(it.id)!;
    if (r.entity && !r.reviewRequired) confident.set(it.threadId, [...(confident.get(it.threadId) ?? []), { id: it.id, name: r.entity.name }]);
  }
  const out = new Map<string, CompanyResolution>();
  for (const it of items) {
    const mates = [...new Set((confident.get(it.threadId) ?? []).filter((m) => m.id !== it.id).map((m) => m.name))];
    out.set(it.id, resolveCompany({ ...it, learnedVendors: learned, threadCompanies: mates, knownCompanies }, cfg));
  }
  return out;
}
