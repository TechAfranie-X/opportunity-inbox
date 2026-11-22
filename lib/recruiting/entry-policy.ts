import { NEAR_MISS, NEAR_MISS_WEAK } from "../reliability/flags.ts";
import { roleRelationV2 } from "../lifecycle/cycle.ts";
import { specific } from "../lifecycle/identity.ts";
import { companyKey } from "./company.ts";
import type { EffectiveEvent, Opportunity } from "./types.ts";

/**
 * Entry policy: an application is created by EVIDENCE, and continued by attribution.
 *
 * Verified against the real mailbox (read-only, message by message): of the opportunities that existed only because the local model said so, almost none were the student's own application: job
 * alerts, event and webinar registrations, email verifications, marketing from tools the student uses, and a person's reply. The rule reader's applications were about 90% genuine. So a model-only
 * reading may CONTINUE an application that has real evidence (it is attributed to it by thread, role and employer, exactly as before), but it may not CREATE one. An opportunity made only of
 * unconfirmed, uncorroborated model-only events does not enter the pipeline (a model-found application IS corroborated when the message itself states the student's own application and is not marketing: signal `entry:corroborated`): its events wait, collapsed, as "possible" (one click, "Looks right", brings them in; the person's word always wins).
 * Nothing is deleted or rewritten; this is a view over stored events. `build` is the grouping function.
 */
// (a model reading whose own message states the reader's own application, its ending or its withdrawal is corroborated by the message: ownApplicationStatement / ownEnding / withdrawalAcknowledged)
const modelOnly = (e: EffectiveEvent) => e.signals.includes("semantic:event") && !e.signals.includes("entry:corroborated") && !e.signals.some((x) => x === "own:receipt" || x === "ending:own" || x === "withdrawal:ack") && !e.corrected && !e.confirmed;
export const ENTRY_REASON = "possible: this looks like it could be one of your applications, but nothing in your mail confirms it (no application receipt or reply). Is it?";

export function applyEntryPolicy(events: EffectiveEvent[], build: (events: EffectiveEvent[]) => Opportunity[]): { kept: EffectiveEvent[]; demoted: EffectiveEvent[] } {
  const first = build(events);
  const drop = new Set<string>(), demoted: EffectiveEvent[] = [];
  for (const o of first) {
    const inbound = o.events.filter((e) => !e.outbound);
    // (a) built only from uncorroborated model readings, or (b) one message that names no employer at all: neither is evidence of an application the person made (all six such cases checked against the real mailbox were junk)
    // (c) every message is an event, survey, platform notice or community message (the message-class signals): attending or answering, not applying
    const programJourney = inbound.some((e) => e.signals.includes("class:program-acceptance") || e.signals.some((x) => x.startsWith("program:evidence:")));
    const classOnly = !programJourney && inbound.length > 0 && inbound.every((e) => !e.corrected && !e.confirmed && e.signals.some((x) => /^class:(?:event|survey|notice|community|admin|logistics|marketing)$/.test(x)));
    const noEmployer = !programJourney && o.company === "Unknown company" && inbound.length === 1 && !inbound[0].corrected && !inbound[0].confirmed;
    if (inbound.length === 0 || programJourney || !(inbound.every(modelOnly) || noEmployer || classOnly)) continue;
    for (const e of o.events) drop.add(e.id);
    for (const e of inbound) demoted.push({ ...e, signals: [...e.signals, NEAR_MISS, NEAR_MISS_WEAK, "entry:uncorroborated"], reviewReasons: [ENTRY_REASON] });
  }
  return { kept: events.filter((e) => !drop.has(e.id)), demoted };
}

/**
 * A model-only claim of an OFFER or an ENDING with no evidence for that specific claim does not stand as one. Stored events from before the decision engine carry no decision signal; those typed
 * offer / rejection / withdrawn by the model alone (not corroborated, not confirmed, not corrected) are shown as an ordinary update and keep a signal naming the unverified claim. Events the engine
 * decided carry a `decision:` signal and are left alone (the engine already weighs them).
 */
export function retypeUnverifiedClaims(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => (e.signals.includes("semantic:event") && !e.signals.some((s) => s.startsWith("decision:")) && !e.signals.includes("entry:corroborated") && !e.corrected && !e.confirmed && ["offer", "rejection", "withdrawn"].includes(e.type) && !e.outbound
    ? { ...e, type: "status_update" as const, signals: [...e.signals, `claim:unverified:${e.type}`] } : e));
}

/**
 * A stored UPDATE whose text ends the application (signal ending:wording, stamped from the real message) is shown as a PROPOSED rejection: the application stays active and visible, the evidence
 * is kept, and nothing is settled on it. Confirmed or corrected events are the person's word and are left alone; events the engine decided are left alone.
 */
export function proposeMissedEndings(events: EffectiveEvent[]): EffectiveEvent[] {
  const PROCESS = new Set(["applied", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer"]);
  // an application ANCHOR at the same employer: a real (not model-only, not a message class) application, assessment, interview or offer event earlier in time
  const anchors = events.filter((a) => !a.outbound && a.company && PROCESS.has(a.type) && !a.signals.includes("semantic:event") && !a.signals.some((s) => s.startsWith("class:")));
  const anchored = (e: EffectiveEvent) => !!e.company && anchors.some((a) => a.company && companyKey(a.company) === companyKey(e.company!) && a.occurredAt.getTime() <= e.occurredAt.getTime());
  const open = (e: EffectiveEvent) => !e.corrected && !e.confirmed && !e.outbound && !e.signals.some((s) => s.startsWith("decision:"));
  const quiet = (e: EffectiveEvent) => e.type === "status_update" || e.type === "follow_up";
  // a deterministic ending sentence is credible evidence of its type whatever the reader's own confidence was
  const sure = (e: EffectiveEvent): EffectiveEvent => ({ ...e, confidence: Math.max(e.confidence ?? 0, 0.9), fieldConfidence: { ...(e.fieldConfidence ?? {}), type: Math.max(e.fieldConfidence?.type ?? 0, 0.9) } as EffectiveEvent["fieldConfidence"] });
  return events.map((e) => {
    if (!open(e)) return e;
    // a rule-typed rejection on a message that is a plain receipt (own application stated, no ending sentence) is an application receipt
    if (e.type === "rejection" && e.signals.includes("own:receipt") && !e.signals.includes("ending:wording")) return sure({ ...e, type: "applied" as const, signals: [...e.signals.filter((s) => s !== "terminal:proposed"), "type:receipt-not-rejection"] });
    // the employer acknowledges the candidate's withdrawal: the application ended by the candidate's own decision (verified: two independent statements, theirs and the employer's)
    if (e.signals.includes("withdrawal:ack") && (quiet(e) || e.type === "rejection")) return sure({ ...e, type: "withdrawn" as const, signals: [...e.signals.filter((s) => s !== "terminal:proposed"), "ending:withdrawal-acknowledged"] });
    // a plain ending sentence in employer voice about the reader's own application settles it, with or without an earlier anchor
    if (e.signals.includes("ending:own")) {
      if (quiet(e) || e.type === "applied") return sure({ ...e, type: "rejection" as const, signals: [...e.signals, "ending:settled-from-update"] });
      if (e.type === "rejection" && e.signals.includes("terminal:proposed")) return sure({ ...e, signals: [...e.signals.filter((s) => s !== "terminal:proposed"), "ending:settled-own"] });
    }
    return e.signals.includes("ending:wording") && quiet(e) && anchored(e) ? { ...e, type: "rejection" as const, signals: [...e.signals, "terminal:proposed", "ending:proposed-from-update"] } : e;
  });
}

/** A near miss whose own text ends or withdraws the application of a known employer is not "possible": it is a decided outcome of a real application and enters the pipeline (typed by proposeMissedEndings). */
export function promoteDecisiveNearMisses(possible: EffectiveEvent[]): { promoted: EffectiveEvent[]; rest: EffectiveEvent[] } {
  const namedOf = (e: EffectiveEvent) => e.signals.find((x) => x.startsWith("employer:named:"))?.slice(15);
  const PLATFORM = /\b(?:ziprecruiter|linkedin|indeed|glassdoor|handshake|ripplematch|forage|workday|greenhouse|lever|smartrecruiters|icims|taleo|ashby|hirevue|codesignal|hackerrank|monster|simplyhired|wellfound|builtin)\b/i;
  const known = (e: EffectiveEvent) => ((!!e.company && !/^unknown/i.test(e.company)) || !!namedOf(e)) && !PLATFORM.test(`${e.company ?? ""} ${namedOf(e) ?? ""}`);
  const decisive = (e: EffectiveEvent) => known(e) && !e.outbound && (e.signals.includes("ending:own") || e.signals.includes("withdrawal:ack") || e.signals.includes("own:receipt")) && !e.signals.some((s) => s.startsWith("class:"));
  // (an employer the message itself names replaces an unknown one: "Thank you for your interest in The Coca-Cola Company")
  const named = (e: EffectiveEvent) => (e.company && !/^unknown/i.test(e.company) ? e : { ...e, company: namedOf(e) ?? e.company, signals: [...e.signals, "employer:from-message"] });
  return { promoted: possible.filter(decisive).map((e) => named({ ...e, signals: [...e.signals.filter((s) => !s.startsWith("near-miss")), "entry:corroborated", "entry:decisive-ending"] })), rest: possible.filter((e) => !decisive(e)) };
}

/**
 * A message that is an event, survey, platform notice or community message (message-class signal) cannot move an application's stage: an RSVP is not an interview, a webinar reminder is not an
 * assessment. Its type becomes a plain update (it stays visible, attached where it was found). Confirmed and corrected events are the person's word and are left alone.
 */
export function neutralizeClassed(events: EffectiveEvent[]): EffectiveEvent[] {
  const STAGE = new Set(["applied", "recruiter_outreach", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"]);
  return events.map((e) => (STAGE.has(e.type) && !e.corrected && !e.confirmed && !e.outbound && e.signals.some((s) => /^class:(?:event|survey|notice|community|admin|logistics|marketing)$/.test(s)) && !e.signals.some((s) => s.startsWith("decision:"))
    ? { ...e, type: "status_update" as const, signals: [...e.signals, "type:neutralized-by-class"] } : e));
}

/** Online-assessment platforms send tests, not interviews: an interview-typed invitation from one is an assessment. Confirmed and corrected events are left alone. */
const ASSESSMENT_PLATFORMS = /(?:^|\.)(?:hackerrank|codesignal|codility|testgorilla|vervoe|pymetrics|criteria)\.(?:com|io|net|co)$/i;
export function retypeAssessmentPlatforms(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => ((e.type === "interview_invite" || e.type === "interview_scheduled") && !e.corrected && !e.confirmed && !e.outbound && ASSESSMENT_PLATFORMS.test(e.senderDomain ?? "") && !e.signals.some((s) => s.startsWith("decision:"))
    ? { ...e, type: "assessment" as const, signals: [...e.signals, "type:assessment-platform"] } : e));
}

/**
 * "Your application is incomplete / complete your application" is a nudge about an application the person STARTED, never an interview: a reminder to finish it (an assessment reminder keeps its type: finishing may BE the assessment). Typed by the subject
 * (a subject is a stored field, no text needed); a message that carries a dated, timed appointment keeps its type.
 */
const INCOMPLETE = /\b(?:incomplete application|application (?:is |remains |still )?(?:incomplete|unfinished|not (?:yet )?(?:complete|submitted))|unfinished application|(?:complete|finish|submit) your (?:\w+ ){0,3}application|application reminder)\b/i;
export function retypeIncompleteApplications(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => (["interview_invite", "interview_scheduled"].includes(e.type) && !e.corrected && !e.confirmed && !e.outbound && !(e.eventDate && e.eventDateHasTime) && INCOMPLETE.test(e.subject ?? "") && !e.signals.some((s) => s.startsWith("decision:"))
    ? { ...e, type: "follow_up" as const, signals: [...e.signals, "type:application-incomplete"] } : e));
}

/**
 * A message that only says the SENDER will act next ("I will look for a time and send you an update") and carries no appointment is not an invitation: it is the employer's update. Typed so the journey,
 * Today and the next action all read it as waiting on the employer.
 */
export function retypeAwaitingThem(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => (["interview_invite", "recruiter_outreach"].includes(e.type) && !e.corrected && !e.confirmed && !e.outbound && e.signals.includes("awaiting:them") && !e.eventDate && !e.signals.some((s) => s.startsWith("decision:"))
    ? { ...e, type: "status_update" as const, signals: [...e.signals, "type:awaiting-them"] } : e));
}

/**
 * A model-only "applied" with no corroborating wording (no own-application statement: a welcome message, a promotion, an \"apply now\" invitation, a security code, a reminder) states no application: it waits as a
 * possible item instead of riding into a real application. Receipts, corroborated events, and anything a person confirmed or corrected stay.
 */
export function demoteNonReceipts(events: EffectiveEvent[]): { kept: EffectiveEvent[]; demoted: EffectiveEvent[] } {
  // (a message whose own words state the reader's application is a receipt, whoever read it)
  const demote = (e: EffectiveEvent) => e.type === "applied" && !e.outbound && !e.corrected && !e.confirmed && !e.signals.includes("own:receipt") && e.signals.includes("semantic:event") && !e.signals.includes("entry:corroborated") && !e.signals.some((s) => s.startsWith("decision:"));
  return { kept: events.filter((e) => !demote(e)), demoted: events.filter(demote).map((e) => ({ ...e, signals: [...e.signals, "near-miss", "near-miss:weak", "entry:not-a-receipt"] })) };
}


/**
 * A third party writing ABOUT an employer (an immigration firm, a background-check vendor, an assessment platform, a recruiting agency) is not that employer. When the message subject names exactly one employer
 * that the student has a real application with, and the sender is not that employer (its domain does not carry the name) and the stored company is not named in the subject, the message is the vendor's mail for
 * that employer: the company becomes the named employer (identity evidence `relation:vendor_for:<employer>`), so it attaches to that journey instead of creating a "company" out of the vendor.
 */
export function attachVendorMail(events: EffectiveEvent[]): EffectiveEvent[] {
  const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const PLATFORMS = /\b(?:linkedin|handshake|indeed|glassdoor|ripplematch|forage|workday|greenhouse|lever|smartrecruiters|icims|taleo|ashby|hirevue|codesignal|hackerrank|codility|google|microsoft teams|zoom|slack|calendly|goodtime)\b/i;
  const real = new Map<string, string>(); // companyKey -> display name, from rule-found, non-weak, non-class events
  for (const e of events) if (!e.outbound && e.company && !/^unknown/i.test(e.company) && !PLATFORMS.test(e.company) && !e.signals.includes("semantic:event") && !e.signals.includes("employer:sender-only") && !e.signals.some((s) => s.startsWith("class:"))) real.set(companyKey(e.company), e.company);
  const names = [...real].filter(([, n]) => norm(n).length >= 4).map(([k, n]) => ({ key: k, name: n, words: norm(n).split(" ").filter((w) => w.length >= 4) }));
  const MAIL_ABOUT = new Set(["assessment", "assessment_completed", "status_update", "follow_up", "interview_invite", "interview_scheduled", "offer", "rejection", "recruiter_outreach"]);
  return events.map((e) => {
    if (e.outbound || e.corrected || e.confirmed || !e.company || !e.subject || !MAIL_ABOUT.has(e.type) || e.signals.some((s) => s.startsWith("decision:"))) return e;
    // only a SUSPECT stored company is re-attributed: it came from the sender alone, or with low confidence
    if (!(e.signals.includes("employer:sender-only") || (e.fieldConfidence?.company ?? 1) < 0.5)) return e;
    const subj = ` ${norm(e.subject)} `;
    const own = norm(e.company).split(" ").filter((w) => w.length >= 3);
    if (own.some((w) => subj.includes(` ${w} `))) return e; // the stored company is named in the subject: nothing to attach
    const domain = norm(e.senderDomain ?? "").replace(/ /g, "");
    if (own.some((w) => w.length >= 4 && domain.includes(w))) return e; // the sender IS the stored company
    const hit = names.filter((n) => n.key !== companyKey(e.company!) && n.words.length > 0 && n.words.every((w) => subj.includes(` ${w} `)) && !domain.includes(n.words[0]) && !own.some((w) => n.words.includes(w)));
    if (hit.length !== 1) return e;
    return { ...e, company: hit[0].name, signals: [...e.signals, `relation:vendor_for:${hit[0].name}`] };
  });
}


/**
 * Assessment-platform mail that waits among the possible items (a HackerRank/CodeSignal completion or result, an invitation) is the evidence of an application when its subject names exactly ONE employer
 * the student has a real application with (a receipt or an applied event at that employer, not a programme or a campaign). It is promoted into that employer's journey with the employer set; nothing else
 * is promoted, and an ambiguous subject (two applications' employers, none) leaves it where it is.
 */
export function recoverVendorEvidence(events: EffectiveEvent[], possible: EffectiveEvent[]): { events: EffectiveEvent[]; possible: EffectiveEvent[] } {
  const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const PLATFORM_DOMAIN = /(?:^|\.)(?:hackerrank|hackerrankforwork|codesignal|codility|testgorilla|vervoe|pymetrics|criteria|hirevue|karat|coderpad|hiretual|shl|talentlens)\.(?:com|io|net|co)$/i;
  const employers = new Map<string, string>();
  for (const e of events) if (!e.outbound && e.company && !/^unknown/i.test(e.company) && (e.type === "applied" || e.signals.includes("own:receipt")) && !e.signals.some((s) => s.startsWith("class:")) && !e.signals.includes("semantic:event")) employers.set(companyKey(e.company), e.company);
  const names = [...employers].map(([k, n]) => ({ key: k, name: n, words: norm(n).split(" ").filter((w) => w.length >= 4) })).filter((n) => n.words.length > 0);
  const moved: EffectiveEvent[] = [], stay: EffectiveEvent[] = [];
  for (const e of possible) {
    const ok = !e.outbound && !e.corrected && !e.confirmed && ["assessment", "assessment_completed", "interview_invite"].includes(e.type) && PLATFORM_DOMAIN.test(e.senderDomain ?? "") && !e.signals.some((s) => /^class:(?:marketing|notice|event|community|survey)$/.test(s));
    const subj = ` ${norm(e.subject ?? "")} `;
    const hit = ok ? names.filter((n) => n.words.every((w) => subj.includes(` ${w} `)) || subj.includes(` ${n.key} `)) : [];
    if (hit.length === 1) moved.push({ ...e, company: hit[0].name, signals: [...e.signals.filter((x) => !x.startsWith("near-miss") && x !== "entry:uncorroborated" && x !== "entry:not-a-receipt"), "relation:vendor_for:" + hit[0].name, "entry:corroborated"], reviewReasons: [] });
    else stay.push(e);
  }
  // the same mail that is still among the events with no employer (the platform's name is not one): the employer its subject names is its employer
  const relabelled = events.map((e) => {
    if (e.outbound || e.corrected || e.confirmed || !["assessment", "assessment_completed", "interview_invite"].includes(e.type) || !PLATFORM_DOMAIN.test(e.senderDomain ?? "") || (e.company && !/^unknown/i.test(e.company) && !e.signals.includes("employer:sender-only"))) return e;
    const subj = ` ${norm(e.subject ?? "")} `;
    const hit = names.filter((n) => n.words.every((w) => subj.includes(` ${w} `)) || subj.includes(` ${n.key} `));
    return hit.length === 1 ? { ...e, company: hit[0].name, signals: [...e.signals, "relation:vendor_for:" + hit[0].name, "entry:corroborated"] } : e;
  });
  return { events: [...relabelled, ...moved], possible: stay };
}

const BORROWED = ["role-inherited", "reply-in-recruiting-thread", "known-contact-continuity", "outbound-in-recruiting-thread"];
/**
 * The role a message NAMES in its own words ("Thank you for applying to the ICSC Foundation Bridge Program") is the role of that message when the stored role is generic, was copied from another message,
 * or is contradicted by the receipt itself. Applied BEFORE grouping so identity, keys and what Today, Pipeline and Review display all agree (one application per named opportunity; a host that
 * receipts several programmes yields several applications). A person's correction or confirmation is never overridden.
 */
export function applyNamedRoles(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => {
    if (e.outbound || e.corrected || e.confirmed) return e;
    const named = e.signals.find((x) => x.startsWith("role:named:"))?.slice(11);
    if (!named || named === e.role) return e;
    const generic = !specific(e.role);
    const borrowed = BORROWED.some((x) => e.signals.includes(x));
    const contradicted = e.signals.includes("own:receipt") && !!e.role && roleRelationV2(e.role, named) !== "match";
    // a reply that continues a job's thread and merely MENTIONS a programme keeps the job title it carries (the programme is evidence of its own journey, not this message's identity)
    const JOB = /\b(?:intern(?:ship)?s?|engineer(?:ing)?|developer|analyst|associate|scientist|researcher|coordinator|manager|designer|technician|consultant|co-?op|apprentice(?:ship)?|trainee|officer|specialist)\b/i;
    if (!e.signals.includes("own:receipt") && !e.signals.includes("class:program-acceptance") && e.gmailThreadId !== e.gmailMessageId && !!e.role && JOB.test(e.role) && !JOB.test(named)) return e;
    return generic || borrowed || contradicted ? { ...e, role: named, signals: [...e.signals, "role:from-message"] } : e;
  });
}


/** An employer the message names replaces an unknown or sender-only one (never a person's correction): "Thank you for your interest in Texas Instruments" is a Texas Instruments message even when it came through a job board. */
export function applyNamedEmployer(events: EffectiveEvent[]): EffectiveEvent[] {
  return events.map((e) => {
    if (e.outbound || e.corrected || e.confirmed) return e;
    const named = e.signals.find((x) => x.startsWith("employer:named:"))?.slice(15);
    if (!named) return e;
    const unknown = !e.company || /^unknown/i.test(e.company);
    const weak = e.signals.includes("employer:sender-only") && (e.fieldConfidence?.company ?? 1) < 0.5;
    const channel = e.signals.some((x) => /sender is (?:job_board|ats)|not the employer/i.test(x)) || (e.reviewReasons ?? []).some((r) => /not the employer|sender is (?:job_board|ats)/i.test(r));
    return unknown || weak || channel ? { ...e, company: named, signals: [...e.signals, "employer:from-message"] } : e;
  });
}

const PROGRAM_NOUN = /\b(?:program(?:me)?|fellowship|academy|cohort|boot ?camp|institute|certificate|course|workshop|bridge|training|student application|launch)\b/i;
const GENERIC = new Set(["program", "programme", "fellowship", "application", "applications", "update", "confirmed", "confirmation", "invitation", "invited", "thank", "thanks", "your", "reminder", "session", "sessions", "welcome", "congratulations", "powered", "project", "important", "action", "required", "this", "that", "with", "from", "have", "will", "next", "step", "steps", "email", "message", "week", "today", "tonight", "tomorrow", "event", "events", "info", "last", "chance", "join", "student", "students", "spring", "summer", "fall", "winter", "2025", "2026", "2027"]);
const toks = (x: string | null | undefined) => new Set((x ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w)));

/**
 * Programme evidence finds its programme. A receipt naming a programme (or an acceptance into one, or a fellowship's own correspondence) is an ANCHOR; messages that are about the same programme (its
 * sessions, cohort calendar invitations, assignments, section reminders, "welcome", "interview confirmation" for it) share its distinctive words in their subject and come from its host. They are
 * attached to the anchor's journey as programme EVIDENCE: never a job stage (their interview/assessment/offer type becomes a plain update), never demoted to "possible" because a model read them,
 * and never a job application of their own. A message with no anchor stays where it was. Distinctive words, not any programme's name.
 */
export function attachProgramEvidence(events: EffectiveEvent[], possible: EffectiveEvent[]): { events: EffectiveEvent[]; possible: EffectiveEvent[] } {
  type Anchor = { e: EffectiveEvent; tokens: Set<string>; nameTokens: Set<string>; key: string };
  // an internship / engineering role is a JOB even when its name says "Program"; a programme anchor must not be one (a fellowship is a programme, a "Fellow" is not a job title here)
  const JOB_TITLE = /\b(?:intern(?:ship)?s?|engineer(?:ing)?|developer|analyst|associate|scientist|researcher|coordinator|manager|designer|technician|consultant|co-?op|apprentice(?:ship)?|trainee|officer|specialist)\b/i;
  // (a reply inside a JOB's thread that mentions a programme is the job conversation, not a programme's own message: it never anchors one)
  const jobThreadReply = (e: EffectiveEvent) => e.gmailThreadId !== e.gmailMessageId && !!e.role && JOB_TITLE.test(e.role) && !e.signals.includes("class:program-acceptance");
  const isAnchor = (e: EffectiveEvent) => !e.outbound && !jobThreadReply(e) && !e.signals.includes("recovered:programme-evidence") && (e.signals.includes("class:program-acceptance") || (!!e.company && !/^unknown/i.test(e.company))) && (e.signals.includes("class:program-acceptance") || !JOB_TITLE.test(`${e.signals.find((x) => x.startsWith("role:named:"))?.slice(11) ?? e.role ?? ""} ${e.subject ?? ""}`)) && (e.signals.includes("class:program-acceptance") || ((e.signals.includes("program:enrolled") || e.signals.includes("program:accepted")) && PROGRAM_NOUN.test(`${e.company} ${e.role ?? ""} ${e.subject ?? ""}`) && !e.signals.some((x) => x === "class:marketing" || x === "class:notice")) || ((e.signals.includes("own:receipt") || e.signals.includes("ending:own")) && (PROGRAM_NOUN.test(e.role ?? "") || PROGRAM_NOUN.test(e.company ?? "") || PROGRAM_NOUN.test(e.subject ?? ""))));
  // the programme's NAME: the position the message names, else its own stored role when that is a programme name, else (a course, a cohort) its host's name. An acceptance never lends the role of a JOB
  // the student also applied for (that is how a programme's mail ended up inside a job's journey).
  const programName = (e: EffectiveEvent): string | null => e.signals.find((x) => x.startsWith("role:named:"))?.slice(11) ?? (e.role && PROGRAM_NOUN.test(e.role) && !e.signals.some((x) => ["role-inherited", "known-contact-continuity", "reply-in-recruiting-thread"].includes(x)) ? e.role : (e.company && !/^unknown/i.test(e.company) ? e.company : null));
  // an acceptance the entry policy waits to promote (no employer of its own) is still a programme's anchor: its sessions and confirmations attach to it
  const promotedAcceptances = possible.filter((e) => !e.outbound && e.signals.includes("class:program-acceptance") && !e.corrected);
  const anchorRaw = [...events, ...promotedAcceptances].filter(isAnchor);
  const nameOf = new Map(anchorRaw.map((e) => [e.id, programName(e)] as const));
  // a company the student applied to for JOBS (a job receipt with a title role) is an employer, not a programme host: its programme anchors must carry their own programme name (never the company's),
  // and match other mail only on that programme name, never on the company's words
  const employerKeys = new Set(events.filter((e) => !e.outbound && !!e.company && e.signals.includes("own:receipt") && JOB_TITLE.test(e.signals.find((x) => x.startsWith("role:named:"))?.slice(11) ?? e.role ?? "")).map((e) => companyKey(e.company!)));
  const isEmployer = (e: EffectiveEvent) => !!e.company && employerKeys.has(companyKey(e.company));
  const anchors: Anchor[] = anchorRaw.filter((e) => !!nameOf.get(e.id) && !(isEmployer(e) && nameOf.get(e.id) === e.company)).map((e) => ({ e: { ...e, role: nameOf.get(e.id)! }, tokens: new Set([...toks(nameOf.get(e.id)), ...(isEmployer(e) ? [] : toks(e.company)), ...(isEmployer(e) ? [] : toks(e.subject))].filter((t) => !isEmployer(e) || !toks(e.company).has(t))), nameTokens: new Set([...toks(nameOf.get(e.id))].filter((t) => !isEmployer(e) || !toks(e.company).has(t))), key: companyKey(e.company ?? e.senderDomain ?? "") }));
  const anchorRole = new Map(anchors.map((a) => [a.e.id, a.e.role!] as const));
  // an acceptance with no company or role of its own becomes its own anchor (a programme journey) once it is promoted below
  // A host that writes hundreds of messages (a programme operator announcing partner programmes) says "real estate", "program", "bridge" in most of them: a word that appears in more than an eighth of one
  // sender's subjects identifies nothing, so it never counts as shared evidence between two of that sender's messages.
  const df = new Map<string, { total: number; tokens: Map<string, number> }>();
  for (const x of [...events, ...possible]) {
    if (x.outbound || !x.senderDomain) continue;
    const d = df.get(x.senderDomain) ?? { total: 0, tokens: new Map<string, number>() };
    d.total += 1; for (const t of toks(x.subject)) d.tokens.set(t, (d.tokens.get(t) ?? 0) + 1);
    df.set(x.senderDomain, d);
  }
  const hostGeneric = (domain: string | null | undefined, t: string) => { const d = domain ? df.get(domain) : undefined; return !!d && d.total >= 12 && (d.tokens.get(t) ?? 0) / d.total > 0.12; };
  const used = new Set<string>();
  const attach = (e: EffectiveEvent, crossHost = false): EffectiveEvent | null => {
    if (e.outbound || e.corrected || e.confirmed || anchors.length === 0 || e.signals.includes("recovered:programme-evidence")) return null; // (recovered evidence already names its programme)
    if (e.signals.some((x) => x === "class:marketing" || x === "class:notice" || x === "class:admin" || x === "entry:not-a-receipt")) return null; // campaigns, platform notices and promotions that only look like receipts are not the programme's own mail
    // a rule-read employer-process message (an assessment, an interview, an offer, a rejection the RULE reader found) is that application's evidence, never a programme's
    if (["assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"].includes(e.type) && !e.signals.includes("semantic:event") && !e.signals.some((x) => x.startsWith("class:"))) return null;
    // a message that is a receipt, or that names its OWN opportunity, is that opportunity's evidence, never another programme's
    if (e.signals.includes("own:receipt") || (e.signals.some((x) => x.startsWith("role:named:")) && !e.signals.includes("class:program-acceptance"))) return null;
    // (a programme acceptance whose subject names nothing carries the programme's name in its own words: the named position)
    const mine = new Set([...toks(e.subject), ...(e.signals.includes("class:program-acceptance") ? toks(e.signals.find((x) => x.startsWith("role:named:"))?.slice(11)) : [])]);
    if (mine.size === 0) return null;
    let best: { a: Anchor; score: number } | null = null, tie = false;
    for (const a of anchors) {
      if (a.e.id === e.id) continue;
      const shared = [...mine].filter((t) => a.tokens.has(t) && !hostGeneric(e.senderDomain, t));
      const sameHost = (e.company && companyKey(e.company) === a.key) || (e.senderDomain && e.senderDomain === a.e.senderDomain);
      const score = shared.length >= 2 || (shared.length === 1 && shared[0].length >= 7) ? shared.length + (sameHost ? 1 : 0) : 0;
      // an event the grouping could not place (flagged ambiguous) may join a programme of ANOTHER host when its subject names that programme and none of its own employer's words
      const ownWords = toks(e.company);
      // (the programme's own name words must be MOSTLY present: a message that merely shares two words with a programme is not about it)
      const nameShared = [...a.nameTokens].filter((t) => mine.has(t)).length;
      const crossOk = crossHost && shared.length >= 2 && a.nameTokens.size > 0 && nameShared / a.nameTokens.size >= 0.6 && ![...ownWords].some((w) => mine.has(w));
      // (a programme's dated session mail sent through a scheduler names the programme in its subject: three or more of the programme's own words)
      const crossSessions = crossHost && e.signals.includes("class:event") && shared.length >= 3 && shared.every((t) => a.tokens.has(t));
      if (score === 0 || (!sameHost && !crossOk && !crossSessions)) continue;
      if (!best || score > best.score) { best = { a, score }; tie = false; } else if (score === best.score && companyKey(a.e.company ?? "") !== companyKey(best.a.e.company ?? "") && [...a.tokens].filter((t) => best!.a.tokens.has(t)).length < 2) tie = true; // (two anchors that are the same programme under two host spellings do not tie)
    }
    if (!best || tie) {
      // a single-programme HOST: sessions, progress and calendar mail from the programme's own sender, inside its active window, belong to it even when the subject shares no words
      const sessionLike = e.signals.some((x) => /^class:(?:event|admin|community|survey)$/.test(x));
      const GENERIC_HOST = /(?:^|\.)(?:greenhouse-mail|greenhouse|lever|myworkday|workday|icims|smartrecruiters|ashbyhq|taleo|hirevue|codesignal|hackerrank|typeform|slack|zoom|calendly|google|gmail|luma|lu\.ma|eventbrite|mailchimp|hubspot|microsoft|outlook|teams|discord|notion|typeform|substack|linkedin|facebook|meetup)\./i;
      const hostAnchors = anchors.filter((a) => !!e.senderDomain && a.e.senderDomain === e.senderDomain && !GENERIC_HOST.test(`${e.senderDomain}.`));
      const names = new Set(hostAnchors.map((a) => [...a.nameTokens].sort().join(" ")));
      // a programme acceptance from the host, within weeks of exactly one programme RECEIPT of that host, is that programme's acceptance ("accepted from the waitlist")
      const t0 = e.occurredAt.getTime();
      const receipts = hostAnchors.filter((a) => a.e.type === "applied" && a.e.signals.includes("own:receipt") && a.e.occurredAt.getTime() <= t0 && t0 - a.e.occurredAt.getTime() <= 45 * 86_400_000);
      if (e.signals.includes("class:program-acceptance") && receipts.length > 0 && new Set(receipts.map((a) => [...a.nameTokens].sort().join(" "))).size === 1) {
        best = { a: receipts[receipts.length - 1], score: 1 }; tie = false;
      } else {
      if (!sessionLike || hostAnchors.length === 0 || names.size !== 1) return null;
      const t = e.occurredAt.getTime(), first = Math.min(...hostAnchors.map((a) => a.e.occurredAt.getTime())), last = Math.max(...hostAnchors.map((a) => a.e.occurredAt.getTime()));
      if (t < first - 14 * 86_400_000 || t > last + 120 * 86_400_000) return null;
      best = { a: hostAnchors[0], score: 1 }; tie = false;
      }
    }
    if (!best || tie) return null;
    const STAGE = new Set(["applied", "recruiter_outreach", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer"]);
    used.add(e.id);
    return { ...e, company: best.a.e.company ?? e.company, role: best.a.e.role ?? e.role, type: (STAGE.has(e.type) && !e.signals.includes("class:program-acceptance")) || (e.type === "offer" && e.signals.includes("class:program-acceptance")) ? "status_update" : e.type, // (an acceptance into a programme is never a job OFFER; its stage is the programme state)
      signals: [...e.signals.filter((x) => !x.startsWith("near-miss") && x !== "entry:uncorroborated"), "entry:corroborated", `program:evidence:${best.a.e.gmailMessageId.slice(0, 8)}`], reviewReasons: [] };
  };
  const rename = (e: EffectiveEvent): EffectiveEvent => (anchorRole.has(e.id) && e.role !== anchorRole.get(e.id) && !e.corrected && !e.confirmed ? { ...e, role: anchorRole.get(e.id)!, signals: [...e.signals, "program:named"] } : e);
  const outEvents = events.map(rename).map((e) => (e.signals.some((x) => /^class:(?:event|admin|logistics|community|survey)$/.test(x)) || e.signals.includes("class:program-acceptance") || (!e.signals.includes("program:named") && !e.signals.some((x) => x.startsWith("program:evidence:"))) ? attach(e, !isAnchor(e)) ?? e : e));
  const moved: EffectiveEvent[] = [], stay: EffectiveEvent[] = [];
  for (const e of possible) { const a = attach(e, e.signals.includes("class:event")); if (a) moved.push(a); else if (promotedAcceptances.includes(e)) moved.push({ ...e, signals: [...e.signals.filter((x) => !x.startsWith("near-miss") && x !== "entry:uncorroborated"), "entry:corroborated", "program:own-journey"], reviewReasons: [] }); else stay.push(e); }
  return { events: [...outEvents, ...moved], possible: stay };
}


/**
 * Mass-mailing campaigns and platform notices (message classes marketing / notice) are never part of a journey: an application, a programme or an event keeps its own mail, and a host's weekly
 * "apply here" campaign is prospecting. They are removed from the pipeline one by one (they wait in the possible list, resolved by their class), whatever journey the grouping would have put them in.
 * A person's confirmation or correction keeps one in.
 */
export function demoteCampaigns(events: EffectiveEvent[]): { kept: EffectiveEvent[]; demoted: EffectiveEvent[] } {
  // (a programme's own completion / removal / award / acceptance is never a campaign, whatever else the message says: stay in touch, follow us)
  const out = (e: EffectiveEvent) => !e.outbound && !e.corrected && !e.confirmed && e.signals.some((x) => x === "class:marketing" || x === "class:notice") && !e.signals.some((x) => /^program:(?:completed|removed|awarded|accepted|enrolled|invited)$/.test(x));
  return { kept: events.filter((e) => !out(e)), demoted: events.filter(out).map((e) => ({ ...e, signals: [...e.signals, "near-miss", "near-miss:weak", "entry:campaign"], reviewReasons: [] })) };
}
