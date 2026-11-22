import { identityContext } from "../recruiting/product-config.ts";
import { companyKey } from "../recruiting/company.ts";
import { reconstructJourney } from "./journey.ts";
import type { EffectiveEvent, Opportunity } from "../recruiting/types.ts";

/**
 * Source-backed investigation: before a doubt becomes a question for the student, the product asks what the evidence it already holds says about it. Each resolver compares the doubt with related
 * evidence (the message's own deterministic facts, the other messages of the same Gmail thread and journey, the employer named in the subject) and either RESOLVES it with a stated reason and the ids
 * of the evidence it used, or leaves it OPEN. A resolved doubt is not hidden: it is listed with its explanation in the Review screen and can be reopened by the person. Nothing here reads message
 * text (only stored fields and stamped facts), nothing is guessed (no resolver decides without independent corroboration), and a person's correction or confirmation is never touched.
 */
export const RESOLVER_VERSION = "investigate-1";

export type Evidence = { kind: string; ref: string };
export type Resolution = { eventId: string; gmailMessageId: string; resolver: string; decision: string; explanation: string; evidence: Evidence[] };

const has = (e: EffectiveEvent, s: string) => e.signals.includes(s);
const hasPrefix = (e: EffectiveEvent, p: string) => e.signals.some((x) => x.startsWith(p));
const id8 = (e: EffectiveEvent) => e.gmailMessageId.slice(0, 8);
const isRule = (e: EffectiveEvent) => !has(e, "semantic:event") && !e.outbound;

const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const subjectNames = (e: EffectiveEvent) => {
  if (!e.company || !e.subject) return false;
  const subj = ` ${norm(e.subject)} `;
  return norm(e.company).split(" ").some((w) => w.length >= 4 && subj.includes(` ${w} `));
};

type Ctx = { o: Opportunity; e: EffectiveEvent };
const ASSESSMENT_PLATFORM = /(?:^|\.)(?:hackerrank|hackerrankforwork|codesignal|codility|testgorilla|vervoe|pymetrics|criteria)\.(?:com|io|net|co)$/i;
const OWN_PROCESS = (e: EffectiveEvent) => has(e, "own:receipt") || has(e, "application confirmation") || has(e, "closure (fact)") || has(e, "ending:own") || has(e, "withdrawal:ack") || hasPrefix(e, "program:evidence:") || has(e, "class:program-acceptance");

/** The type the reader gave is the one the message's own facts say. */
function typeByFacts({ e }: Ctx): Resolution | null {
  const reasons = e.reviewReasons ?? [];
  if (reasons.length > 0 && !reasons.some((r) => /^type: /i.test(r) || /^conflict: /i.test(r) && !/second reader/i.test(r) || /^conflict: a second reader/i.test(r))) return null;
  const mk = (kind: string, text: string): Resolution => ({ eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "type-by-facts", decision: `type ${e.type} confirmed`, explanation: text, evidence: [{ kind, ref: id8(e) }] });
  if (e.type === "applied" && has(e, "own:receipt")) return mk("own-application-receipt", "The message states the student's own application and contains no ending sentence: it is an application receipt.");
  if (e.type === "rejection" && (has(e, "ending:own") || has(e, "ending:settled-from-update") || has(e, "ending:settled-own"))) return mk("own-ending-sentence", "The employer states in plain words that it is not moving forward with this application.");
  if (e.type === "withdrawn" && (has(e, "withdrawal:ack") || has(e, "ending:withdrawal-acknowledged"))) return mk("withdrawal-acknowledged", "The employer acknowledges that the student withdrew.");
  if (e.type === "assessment" && ASSESSMENT_PLATFORM.test(e.senderDomain ?? "")) return mk("assessment-platform-sender", "An online-assessment platform sent it, naming the employer's test.");
  if (e.type === "assessment" && e.eventDate && /assessment|coding challenge|online test|hackerrank|codesignal/i.test(e.subject ?? "")) return mk("dated-assessment", "The subject names an assessment and the message carries its deadline.");
  if ((e.type === "interview_scheduled" || e.type === "interview_invite") && e.eventDate && e.eventDateHasTime && /interview/i.test(e.subject ?? "")) return mk("dated-interview", "The subject names an interview and the message carries its date and time.");
  return null;
}

/** "The wording reads like a goodbye": a stale doubt when the message's current text contains no ending sentence at all. */
function staleGoodbye({ e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /^conflict: /i.test(r) && !/second reader/i.test(r))) return null;
  // the product now reads the message as the ending it sounds like: the stored "goodbye vs update" conflict is answered
  if ((e.type === "rejection" || e.type === "withdrawn") && (has(e, "ending:wording") || has(e, "ending:own") || has(e, "closure (fact)") || has(e, "withdrawal:ack"))) return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "stale-goodbye", decision: `typed as ${e.type}`, explanation: "The message ends the application in plain words and is now read as that ending.", evidence: [{ kind: "ending-sentence", ref: id8(e) }] };
  if (e.type === "rejection" || e.type === "withdrawn") return null;
  if (has(e, "ending:wording") || has(e, "ending:own") || has(e, "withdrawal:ack")) return null;
  if (!has(e, "own:receipt") && !hasPrefix(e, "class:") && !has(e, "ending:checked")) return null; // only when the facts positively explain the message
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "stale-goodbye", decision: `type ${e.type} kept`, explanation: "The goodbye-like words are a condition or part of a receipt, not an ending sentence in the message's current text.", evidence: [{ kind: has(e, "own:receipt") ? "own-application-receipt" : "message-class", ref: id8(e) }] };
}

/** The company is not confident, but the message's own subject names it, or another confident message of the same Gmail thread in the same journey does. */
function employerByCorroboration({ o, e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /^company: /i.test(r))) return null;
  if (!e.company || /^unknown/i.test(e.company)) return null;
  if (subjectNames(e)) return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "employer-by-corroboration", decision: `employer ${e.company} kept`, explanation: "The message's subject names the employer, so the name did not come from the sender alone.", evidence: [{ kind: "subject-names-employer", ref: id8(e) }] };
  const mate = o.events.find((x) => x !== e && !x.outbound && x.gmailThreadId === e.gmailThreadId && x.company && companyKey(x.company) === companyKey(e.company!) && (x.fieldConfidence?.company ?? 0) >= 0.6 && !has(x, "employer:sender-only"));
  if (mate) return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "employer-by-corroboration", decision: `employer ${e.company} kept`, explanation: "Another message of the same Gmail thread states the same employer with confidence.", evidence: [{ kind: "same-thread-employer", ref: id8(mate) }] };
  return null;
}

/** "We could not tie this to one of your applications": it sits in a journey with a rule-found, unconcerning message of the same Gmail thread (thread continuity corroborated by independent evidence). */
function membershipByThread({ o, e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /^membership: /i.test(r))) return null;
  const anchor = o.events.find((x) => x !== e && isRule(x) && x.gmailThreadId === e.gmailThreadId && !has(x, "near-miss") && (x.type === "applied" || x.type === "assessment" || x.type === "interview_invite" || x.type === "interview_scheduled" || x.type === "rejection" || x.type === "offer") && !hasPrefix(x, "class:"));
  if (!anchor) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "membership-by-thread", decision: "belongs to this application", explanation: "A rule-read application message of the same Gmail thread is already part of this journey.", evidence: [{ kind: "same-thread-application-message", ref: id8(anchor) }] };
}

/** "A second reader thinks this is not recruiting mail" / "could not tie this to an application": the message itself states the reader's own process (a receipt, an ending, a programme acceptance), so it IS recruiting mail. */
function ownProcessStatement({ e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /^conflict: a second reader|^membership: /i.test(r))) return null;
  if (!OWN_PROCESS(e)) return null;
  const kind = has(e, "own:receipt") ? "own-application-receipt" : has(e, "ending:own") ? "own-ending-sentence" : hasPrefix(e, "program:evidence:") ? "programme-evidence" : "own-process-statement";
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "own-process-statement", decision: "recruiting", explanation: "The message states the student's own application, ending or programme in its own words, so it is part of their recruiting process.", evidence: [{ kind, ref: id8(e) }] };
}

/** "The company comes from reading the message / is not clear": the message names the employer in its own words (stamped fact), or the product already attached it by that name. */
function companyByMessage({ e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /^company: |not clear from this message/i.test(r))) return null;
  if (!has(e, "employer:from-message") && !(hasPrefix(e, "employer:named:") && e.company && e.signals.some((x) => x === `employer:named:${e.company}`))) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "company-by-message", decision: `employer ${e.company} kept`, explanation: "The message names the employer in its own words (\"your interest in …\", \"your application to …\").", evidence: [{ kind: "employer-named-in-message", ref: id8(e) }] };
}

/** "Looks like a program or event": the product has already routed it as a programme (its journey is a programme and carries the programme evidence). */
function programLooksLike({ o, e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /looks like a program or event/i.test(r))) return null;
  if (o.kind === "job" || o.kind === undefined) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "program-routed", decision: `kept as a ${o.kind}`, explanation: "This journey is already a programme, kept apart from your job pipeline.", evidence: [{ kind: "programme-journey", ref: id8(e) }] };
}

/**
 * "Could this belong to another application?": the one-email investigation (lib/investigate/journey.ts) compares the candidate applications on role, cycle, requisition, programme, thread and
 * chronology. The doubt is resolved only when the application the message sits in leads on HARD independent evidence (the same Gmail thread, the same requisition, or the role the message itself
 * names) and no other surviving candidate has any, with a clear margin over the best alternative. Soft similarity (same employer, nearby dates, a shared host) never resolves it.
 */
function identityByJourney({ o, e }: Ctx, all: Opportunity[]): Resolution | null {
  const isFlag = e.signals.includes("identity:ambiguous") || e.signals.some((x) => x.startsWith("identity:suggest:"));
  if (!isFlag) return null;
  const j = reconstructJourney(e.gmailMessageId.slice(0, 12), { opportunities: all, ctx: identityContext() });
  if (!j || j.decision !== "resolved") return null;
  const home = j.candidates.find((c) => c.key === o.key);
  if (!home || home.vetoes.length > 0) return null;
  const rivals = j.candidates.filter((c) => c.key !== o.key && c.vetoes.length === 0);
  // a self-contained application: the message's own subject names the employer, and no other application at that employer survives the comparison
  if (home.hard.length === 0 && home.reasons.includes("no other message in this application") && rivals.length === 0 && subjectNames(e)) return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "identity-by-journey", decision: `belongs to ${o.company}${o.role ? ` · ${o.role}` : ""}`, explanation: "The subject names the employer and no other application at that employer survives the comparison (different role, cycle, or already ended).", evidence: [{ kind: "subject-names-employer", ref: id8(e) }] };
  if (home.hard.length === 0) return null;
  if (rivals.some((c) => c.hard.length > 0 || home.evidence - c.evidence < 2)) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "identity-by-journey", decision: `belongs to ${o.company}${o.role ? ` · ${o.role}` : ""}`, explanation: `Compared with ${j.candidates.length - 1} other candidate application${j.candidates.length === 2 ? "" : "s"}: ${home.hard.join(", ")}; no other surviving candidate has independent evidence.`, evidence: home.hard.map((h) => ({ kind: h.replace(/ /g, "-"), ref: id8(e) })) };
}

/** "Conflicting candidate A / this could be A or B": the two names are one employer (one name is a leading form of the other, or they share their distinctive words). */
function companyAlias({ o, e }: Ctx): Resolution | null {
  const reasons = e.reviewReasons ?? [];
  const r = reasons.find((x) => /conflicting candidate|could be .+ or /i.test(x));
  if (!r || !o.company) return null;
  const names = [...r.matchAll(/(?:candidate |be |or )"?([A-Z][\w&'’ .-]{2,40}?)"?(?: \(|\.| or |$)/g)].map((m) => m[1].trim()).filter(Boolean);
  const words = (x: string) => new Set(norm(x).split(" ").filter((w) => w.length >= 3));
  const same = (a: string, b: string) => { const A = words(a), B = words(b); const shared = [...A].filter((w) => B.has(w)).length; return shared > 0 && shared >= Math.min(A.size, B.size) - (Math.min(A.size, B.size) > 1 ? 1 : 0) || norm(a).replace(/ /g, "").includes(norm(b).replace(/ /g, "")) || norm(b).replace(/ /g, "").includes(norm(a).replace(/ /g, "")); };
  const all = [o.company, ...names];
  if (names.length === 0 || !all.every((n) => same(n, all[0]))) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "company-alias", decision: `employer ${o.company} kept`, explanation: "The candidate names are two forms of one employer name.", evidence: [{ kind: "alias-names", ref: id8(e) }] };
}

/** An assessment sent by an online-assessment platform for an application of the employer the journey already names: the membership question is answered by the sender's role. */
function assessmentByVendor({ o, e }: Ctx): Resolution | null {
  if (!(e.reviewReasons ?? []).some((r) => /^membership: /i.test(r)) || e.type !== "assessment") return null;
  if (!ASSESSMENT_PLATFORM.test(e.senderDomain ?? "") || !o.company || /^unknown/i.test(o.company)) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "assessment-by-vendor", decision: "an assessment of this application", explanation: "An online-assessment platform sent a test naming this employer; that is how employers run assessments.", evidence: [{ kind: "assessment-platform-sender", ref: id8(e) }] };
}

/** A low-confidence plain update that sits in a Gmail conversation the journey already holds with confident messages (a reply, a follow-up inside the same thread). */
function updateInThread({ o, e }: Ctx): Resolution | null {
  if (e.type !== "status_update" && e.type !== "follow_up" && e.type !== "user_reply") return null;
  const reasons = e.reviewReasons ?? [];
  if (reasons.some((r) => !/^type: |^membership: /i.test(r))) return null;
  const mate = o.events.find((x) => x !== e && x.gmailThreadId === e.gmailThreadId && (x.fieldConfidence?.type ?? x.confidence ?? 0) >= 0.8 && !has(x, "semantic:event"));
  if (!mate) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "update-in-thread", decision: "a plain update inside this conversation", explanation: "It sits in a Gmail conversation this journey already holds with confidently read messages.", evidence: [{ kind: "same-thread-confident-message", ref: id8(mate) }] };
}

/** Programme evidence (a session, a cohort calendar message, a welcome, an acceptance) that the product attached to its programme's journey is represented, not unclear. */
function programEvidenceRouted({ o, e }: Ctx): Resolution | null {
  if (!(hasPrefix(e, "program:evidence:") || has(e, "class:program-acceptance")) || o.kind === "job" || o.kind === undefined) return null;
  if ((e.reviewReasons ?? []).some((r) => !/^type: |^membership: |^company: /i.test(r))) return null;
  return { eventId: e.id, gmailMessageId: e.gmailMessageId, resolver: "program-evidence-routed", decision: `part of the ${o.kind} journey`, explanation: "The message is the programme's own mail and sits in the programme's journey, never in a job stage.", evidence: [{ kind: "programme-evidence", ref: id8(e) }] };
}

const RESOLVERS = [programEvidenceRouted, typeByFacts, staleGoodbye, employerByCorroboration, membershipByThread, ownProcessStatement, companyByMessage, programLooksLike, companyAlias, assessmentByVendor, updateInThread];

/** Resolve what the evidence already held can resolve. A person's correction or confirmation is never overridden, and an event with competing flags is resolved only if EVERY stored reason is covered. */
export function investigate(opportunities: Opportunity[]): Map<string, Resolution> {
  const out = new Map<string, Resolution>();
  for (const o of opportunities) for (const e of o.events) {
    if (e.outbound || e.corrected || e.confirmed) continue;
    const reasons = e.reviewReasons ?? [];
    // (a confidence doubt and an identity suggestion carry no stored reason text; the resolvers decide whether the message's facts cover them)
    const found = [...RESOLVERS.map((r) => r({ o, e })), identityByJourney({ o, e }, opportunities)].filter((x): x is Resolution => !!x);
    if (found.length === 0) continue;
    // every reason must be explained by some resolver, else the doubt stays open
    const covered = reasons.every((r) => found.some((f) => explains(f.resolver, r)));
    if (covered) out.set(e.id, { ...found[0], explanation: found.map((f) => f.explanation).join(" "), evidence: found.flatMap((f) => f.evidence), resolver: found.map((f) => f.resolver).join("+") });
  }
  return out;
}

const explains = (resolver: string, reason: string): boolean =>
  (resolver === "type-by-facts" && (/^type: /i.test(reason) || /^conflict: a second reader/i.test(reason) || (/^conflict: /i.test(reason) && !/second reader/i.test(reason)))) ||
  (resolver === "stale-goodbye" && /^conflict: /i.test(reason) && !/second reader/i.test(reason)) ||
  (resolver === "employer-by-corroboration" && /^company: /i.test(reason)) ||
  (resolver === "membership-by-thread" && /^membership: /i.test(reason)) ||
  (resolver === "own-process-statement" && /^conflict: a second reader|^membership: /i.test(reason)) ||
  (resolver === "company-by-message" && /^company: |not clear from this message/i.test(reason)) ||
  (resolver === "program-routed" && /looks like a program or event/i.test(reason)) ||
  (resolver === "program-evidence-routed" && /^type: |^membership: |^company: /i.test(reason)) ||
  (resolver === "company-alias" && /conflicting candidate|could be .+ or |^company: /i.test(reason)) ||
  (resolver === "assessment-by-vendor" && /^membership: /i.test(reason)) ||
  (resolver === "update-in-thread" && /^type: |^membership: /i.test(reason)) ||
  (resolver === "identity-by-journey" && /^identity: |could not tell which of your applications|may belong to another/i.test(reason));
