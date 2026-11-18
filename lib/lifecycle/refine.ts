import { companyKey } from "../recruiting/company.ts";
import { NEAR_MISS, NEAR_MISS_WEAK } from "../reliability/flags.ts";
import type { EffectiveEvent } from "../recruiting/types.ts";

/**
 * Evidence refinement: deterministic, employer-independent checks applied to stored events BEFORE they are grouped and reduced.
 *
 * The extractor reads one message at a time from its subject, sender and body. Several consequential mistakes are visible only with the whole record
 * (a sender display name that is sentence prose, a newsletter that borrows hiring words, "Congratulations on your job offer" that no offer pattern matched).
 * This layer fixes what can be decided from stored evidence alone, never invents a value, and never overrides a person: an event the person corrected or
 * confirmed is left exactly as they set it. The frozen extractor (lib/recruiting/extract.ts) is not modified. See docs/lifecycle-refinement.md.
 *
 *  1. context gate   mail that is not about the reader's own candidacy leaves the pipeline: newsletters and multi-employer digests, mock-interview and course
 *                    practice, consumer-account mail from a bank or broker. It is excluded with a stated reason, never silently, so it can be audited.
 *  2. offers         explicit offer language ("Congratulations on your job offer", "offer of employment") becomes an offer.
 *  3. entities       sentence fragments are stripped from employer and role ("and the 2026 ...", a dangling "(Summer"), a team name is not a role, a trailing year is
 *                    not part of an employer, and a legal/industry suffix variant of an employer already seen is the same employer.
 *  4. polarity       "complete your application"/"incomplete application" is a nudge about an unfinished application, not recruiter interest.
 */
export type ExclusionReason = "newsletter" | "practice" | "course" | "consumer-account";
export type Excluded = { event: EffectiveEvent; reason: ExclusionReason };
export type Refined = { events: EffectiveEvent[]; excluded: Excluded[] };

const NEWSLETTER_SUBJECT = /^[\w .&'’-]{1,40}\s(?:news|newsletter|digest|weekly|roundup)\s*[:|–-]|\bnewsletter\b|\bunsubscribe\b/i;
const NEWSLETTER_SENDER = /\b(?:news|newsletter|digest|updates?)\b/i;
const DIGEST_EVENT = /\bmeet the .{1,50}\bteam\b|\bbefore (?:the )?(?:\w+ ){0,3}(?:recruiting|applications?) (?:opens?|open)\b|\b(?:applications?|recruiting) (?:are |is )?(?:now |officially )?(?:open|opens|opening)\b.*\b(?:join|meet|alums?)\b|\bjoin .{1,60}\+ |\balums?\b.*\bjoin\b/i;
const PRACTICE = /\b(?:mock|practice) interviews?\b|\bbehavioral interview week\b|\binterview (?:prep|practice)\b|\bpeer interview\b/i;
const COURSE = /\bTIP\d{2,3}\b|\bweekly assessment\b|\bunit \d+ assessment\b|\bcourse (?:assessment|project)\b|\bcapstone\b|\breadiness assessment\b/i;
const CONSUMER_SUBJECT = /\bverification code\b|\baccount has been linked\b|\blink(?:ed|ing)? (?:a|your) bank\b|\bfund(?:ing)? your account\b|\bstatement is ready\b/i;
const CONSUMER_DOMAIN = /(?:^|\.)(?:robinhood|coinbase|venmo|paypal|cash|wellsfargo|chase|bankofamerica|schwab|fidelity|sofi|chime|stripe-?pay)\.com$/i;
const EMPLOYMENT_WORDS = /\b(?:job|role|position|internship|intern|career|candidate|interview|recruit\w*|hiring|employment)\b/i;
const ATS_SENDER = /(?:^|\.)(?:greenhouse(?:-mail)?\.io|lever\.co|myworkday\.com|ashbyhq\.com|icims\.com|smartrecruiters\.com|workable\.com|jobvite\.com|modernhire\.com)$/i;

/** Why this message is not about the reader's own candidacy, or null. An employer's applicant-tracking system is never excluded on wording alone. */
export function exclusionReason(e: Pick<EffectiveEvent, "subject" | "senderName" | "senderDomain" | "company">): ExclusionReason | null {
  const subject = e.subject ?? "";
  if (ATS_SENDER.test(e.senderDomain)) return null;
  if (PRACTICE.test(subject)) return "practice";
  if (NEWSLETTER_SUBJECT.test(subject) || DIGEST_EVENT.test(subject) || (e.company && /\bnews(?:letter)?$/i.test(e.company)) || (NEWSLETTER_SENDER.test(e.senderName ?? "") && /\b(?:news|newsletter)\b/i.test(e.senderName ?? "") && !EMPLOYMENT_WORDS.test(subject.replace(/\bnews\b/gi, "")))) return "newsletter";
  if (COURSE.test(subject)) return "course";
  if (CONSUMER_SUBJECT.test(subject) && !EMPLOYMENT_WORDS.test(subject.replace(/\bverification code\b/i, ""))) return "consumer-account";
  // A bank or broker's "your application is pending / expires" is an ACCOUNT application unless it names a job, role or "applying to <employer>"; a finance employer's real
  // application mail ("Thank you for applying to <employer>") is never excluded.
  if (CONSUMER_DOMAIN.test(e.senderDomain) && /\byour application (?:is pending|expires in|has been (?:approved|received))\b/i.test(subject) && !/\bapplying\b|\bapplication (?:to|for|at)\b|\bapplied\b/i.test(subject) && !EMPLOYMENT_WORDS.test(subject)) return "consumer-account";
  return null;
}

const OFFER_SUBJECT = /\bcongratulations\b[^.]{0,60}\b(?:job |internship |employment |full[- ]time )?offer\b|\b(?:job|internship|employment) offer\b|\boffer of employment\b|\boffer letter\b|\bpleased to (?:extend|offer)\b/i;
const NOT_AN_OFFER_FOR_YOU = /\b(?:offers? (?:you )?(?:a )?(?:free|discount)|% off|special offer|limited[- ]time offer|refer a friend|offer expires? (?:soon )?on sale)\b/i;
const OFFER_FROM = new Set<string>(["status_update", "follow_up", "interview_invite", "recruiter_outreach"]);

const TRAILING_CONNECTORS = /\s+(?:and|the|of|for|at|&|to)(?:\s+the)?$/i;
const LEADING_CONNECTORS = /^(?:and|the|of|for|&)\s+(?:the\s+)?(?=[A-Z0-9])/;
const TEAM_ONLY = /^(?:the\s+)?(?:[\w&-]+\s+){0,2}(?:team|teams|department|group)$/i;
const COMPANY_SUFFIX_WORDS = new Set(["insurance", "company", "inc", "corp", "corporation", "llc", "ltd", "group", "holdings", "financial", "bank", "technologies", "technology", "solutions", "services"]);
const NUDGE = /\b(?:incomplete application|complete your application|finish your application|you (?:started|haven'?t finished|have not finished) (?:an |your )?application|application (?:is )?(?:still )?(?:incomplete|pending completion))\b/i;

export function cleanRole(role: string | null): string | null {
  if (!role) return role;
  let r = role.replace(LEADING_CONNECTORS, "").replace(/\s+/g, " ").trim();
  const open = r.lastIndexOf("(");
  if (open >= 0 && r.indexOf(")", open) < 0) r = r.slice(0, open).replace(/[\s,;:-]+$/, "").trim(); // a title cut off mid-parenthesis
  if (TEAM_ONLY.test(r)) return null; // "Engineering team" is prose about who is hiring, not a role
  return r || null;
}

export function cleanCompany(company: string | null): string | null {
  if (!company) return company;
  let c = company.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && TRAILING_CONNECTORS.test(c); i++) c = c.replace(TRAILING_CONNECTORS, "").trim();
  c = c.replace(/\s+(?:19|20)\d{2}$/, "").trim(); // "Ramp 2025": the assessment's name, not the employer
  return c || null;
}

/** The reader rejected a message for lacking recruiting words; an explicit offer or the paperwork that follows one is evidence it missed, not noise. */
const withoutNearMiss = (signals: string[]) => signals.filter((x) => x !== NEAR_MISS && x !== NEAR_MISS_WEAK && !x.startsWith("rejected:"));
const ONBOARDING = /\b(?:background (?:check|screening)|pre-?employment|onboarding|your (?:\w+ ){0,2}start(?: date)?|summer start|equipment|welcome to\b|i-?9|new hire)\b/i;

const settled = (e: EffectiveEvent) => e.corrected || e.confirmed === true;

export function refineEvents(events: EffectiveEvent[]): Refined {
  const excluded: Excluded[] = [];
  const kept: EffectiveEvent[] = [];
  for (const e of events) {
    if (settled(e)) { kept.push(e); continue; }
    const reason = e.outbound ? null : exclusionReason(e);
    if (reason) { excluded.push({ event: e, reason }); continue; }
    const r: EffectiveEvent = { ...e };
    const company = cleanCompany(e.company);
    if (company !== e.company) r.company = company;
    const role = cleanRole(e.role);
    if (role !== e.role) r.role = role;
    if (OFFER_FROM.has(r.type) && OFFER_SUBJECT.test(e.subject ?? "") && !NOT_AN_OFFER_FOR_YOU.test(e.subject ?? "")) {
      r.type = "offer";
      r.signals = withoutNearMiss(e.signals).concat("offer (refined)");
      r.reviewReasons = (e.reviewReasons ?? []).filter((x) => !x.startsWith("possible:"));
      r.fieldConfidence = { type: Math.max(0.9, e.fieldConfidence?.type ?? 0), company: e.fieldConfidence?.company ?? e.confidence, role: e.fieldConfidence?.role ?? e.confidence };
      r.confidence = Math.max(e.confidence, 0.9);
    } else if (r.type === "recruiter_outreach" && NUDGE.test(e.subject ?? "")) {
      r.type = "follow_up";
      r.signals = [...e.signals, "unfinished application (refined)"];
    }
    kept.push(r);
  }
  // Paperwork that follows an offer from the same employer (screening, onboarding, equipment) belongs to the same candidacy; it needs an offer to vouch for it.
  const offerAt = new Map<string, number>();
  for (const e of kept) if (e.type === "offer" && e.company && !e.outbound) { const k = companyKey(e.company); offerAt.set(k, Math.min(offerAt.get(k) ?? Infinity, e.occurredAt.getTime())); }
  for (let i = 0; i < kept.length; i++) {
    const e = kept[i];
    const at = e.company ? offerAt.get(companyKey(e.company)) : undefined;
    if (at !== undefined && !settled(e) && !e.outbound && e.signals.includes(NEAR_MISS) && e.occurredAt.getTime() >= at && ONBOARDING.test(e.subject ?? "")) {
      kept[i] = { ...e, signals: withoutNearMiss(e.signals).concat("after offer (refined)"), reviewReasons: (e.reviewReasons ?? []).filter((x) => !x.startsWith("possible:")), confidence: Math.max(e.confidence, 0.7), fieldConfidence: { type: Math.max(0.7, e.fieldConfidence?.type ?? 0), company: e.fieldConfidence?.company ?? e.confidence, role: e.fieldConfidence?.role ?? e.confidence } };
    }
  }
  // A legal/industry-suffix variant of an employer already seen is that employer ("Acme Insurance Company" with "Acme"): use the shorter, established name.
  const names = new Map<string, string>();
  for (const e of kept) if (e.company) { const k = companyKey(e.company); if (!names.has(k) || e.company.length < names.get(k)!.length) names.set(k, e.company); }
  const keys = [...names.keys()];
  const canonical = (company: string): string => {
    const k = companyKey(company);
    for (const base of keys) {
      if (base !== k && base.length >= 3 && k.startsWith(base)) {
        const rest = company.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
        const baseWords = (names.get(base) ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).length;
        if (rest.slice(baseWords).every((w) => COMPANY_SUFFIX_WORDS.has(w))) return names.get(base)!;
      }
    }
    return company;
  };
  return { events: kept.map((e) => (e.company && !settled(e) && canonical(e.company) !== e.company ? { ...e, company: canonical(e.company) } : e)), excluded };
}

const SCHOLARSHIP = /\b(?:scholarship|fellowship|grant)\b/i;
const MENTORSHIP = /\bmentor(?:ship)?\b/i;
/** Jobs and internships are the default; a scholarship, fellowship or mentorship application is typed so it is never mistaken for employer recruiting. */
export function opportunityKind(events: Pick<EffectiveEvent, "subject" | "role">[]): "job" | "scholarship" | "mentorship" {
  const text = events.map((e) => `${e.subject ?? ""} ${e.role ?? ""}`).join(" ");
  if (/\b(?:intern(?:ship)?|software engineer|analyst|developer)\b/i.test(events.map((e) => e.role ?? "").join(" ")) && !SCHOLARSHIP.test(events.map((e) => e.role ?? "").join(" "))) return "job";
  if (SCHOLARSHIP.test(text)) return "scholarship";
  if (MENTORSHIP.test(text)) return "mentorship";
  return "job";
}
