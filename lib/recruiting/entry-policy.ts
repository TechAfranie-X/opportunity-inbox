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
const modelOnly = (e: EffectiveEvent) => e.signals.includes("semantic:event") && !e.signals.includes("entry:corroborated") && !e.corrected && !e.confirmed;
export const ENTRY_REASON = "possible: this looks like it could be one of your applications, but nothing in your mail confirms it (no application receipt or reply). Is it?";

export function applyEntryPolicy(events: EffectiveEvent[], build: (events: EffectiveEvent[]) => Opportunity[]): { kept: EffectiveEvent[]; demoted: EffectiveEvent[] } {
  const first = build(events);
  const drop = new Set<string>(), demoted: EffectiveEvent[] = [];
  for (const o of first) {
    const inbound = o.events.filter((e) => !e.outbound);
    // (a) built only from uncorroborated model readings, or (b) one message that names no employer at all: neither is evidence of an application the person made (all six such cases checked against the real mailbox were junk)
    // (c) every message is an event, survey, platform notice or community message (the message-class signals): attending or answering, not applying
    const classOnly = inbound.length > 0 && inbound.every((e) => !e.corrected && !e.confirmed && e.signals.some((x) => /^class:(?:event|survey|notice|community|admin|logistics|marketing)$/.test(x)));
    const noEmployer = o.company === "Unknown company" && inbound.length === 1 && !inbound[0].corrected && !inbound[0].confirmed;
    if (inbound.length === 0 || !(inbound.every(modelOnly) || noEmployer || classOnly)) continue;
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
  const decisive = (e: EffectiveEvent) => !!e.company && !/^unknown/i.test(e.company) && !e.outbound && (e.signals.includes("ending:own") || e.signals.includes("withdrawal:ack")) && !e.signals.some((s) => s.startsWith("class:"));
  return { promoted: possible.filter(decisive).map((e) => ({ ...e, signals: [...e.signals.filter((s) => !s.startsWith("near-miss")), "entry:corroborated", "entry:decisive-ending"] })), rest: possible.filter((e) => !decisive(e)) };
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
 * A model-only "applied" with no corroborating wording (no own-application statement: a welcome message, a promotion, an \"apply now\" invitation, a security code, a reminder) states no application: it waits as a
 * possible item instead of riding into a real application. Receipts, corroborated events, and anything a person confirmed or corrected stay.
 */
export function demoteNonReceipts(events: EffectiveEvent[]): { kept: EffectiveEvent[]; demoted: EffectiveEvent[] } {
  const demote = (e: EffectiveEvent) => e.type === "applied" && !e.outbound && !e.corrected && !e.confirmed && e.signals.includes("semantic:event") && !e.signals.includes("entry:corroborated") && !e.signals.some((s) => s.startsWith("decision:"));
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
    return generic || borrowed || contradicted ? { ...e, role: named, signals: [...e.signals, "role:from-message"] } : e;
  });
}
