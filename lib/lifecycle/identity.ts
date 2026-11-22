import { requisitionOf } from "../identity/represented-employer.ts";
import { companyKey } from "../recruiting/company.ts";
import { classifySender } from "../recruiting/entity/vendors.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { rolePairKey, type RoleVerdicts } from "../identity/role-equivalence.ts";
import { cycleOf, cyclesConflict, isRoleFragment, programsConflict, programsOf, roleCore, roleRelationV2, type Cycle } from "./cycle.ts";

/**
 * Opportunity identity v2: which stored events belong to the same application.
 *
 * An opportunity is employer + RECRUITING CYCLE + role (+ program). Every automatic link is evidence weighed against hard conflicts:
 *  - a Gmail thread is EVIDENCE that two messages belong together, never a command: Gmail threads automated mail by subject, so a re-application, a second
 *    role or the next season arrives in the same thread. A conflict in cycle, specific role or program overrules the thread;
 *  - cycle (season and year) and program (externship, fellowship, full-time, ...) are identity, not noise;
 *  - a specific role that matches may link across a long gap only with positive cycle evidence; otherwise it must be recent;
 *  - a person's own constraints (`linkedTo`: this event belongs with that message; `separate`: this event is its own opportunity) are applied before any rule and
 *    are never overridden by one. They live on the event's correction, so they survive re-reading and regrouping.
 */
export type Group = { company: string | null; events: EffectiveEvent[]; threads: Set<string> };

const DAY = 86_400_000;
const GENERIC_WINDOW = 90 * DAY;
const SPECIFIC_WINDOW_NO_CYCLE = 180 * DAY;
const GENERIC_WINDOW_WITH_THREAD = 240 * DAY;
const NEUTRAL = new Set<EventType>(["status_update", "follow_up", "user_reply"]);
const REOPENS = new Set<EventType>(["assessment", "interview_invite", "interview_scheduled", "offer"]);
/** Types whose attribution matters: wrongly attached, they would close, advance or settle another application. Everything else may ride with the latest candidate. */
const CONSEQUENTIAL = new Set<EventType>(["rejection", "withdrawn", "offer", "interview_invite", "interview_scheduled", "assessment", "assessment_completed"]);
const STAGE_BEARING = new Set<EventType>(["applied", "recruiter_outreach", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn"]);

/** The employer name rests only on the sender (or on very weak evidence). */
/** The message's own subject names the employer (any significant word of the name): independent evidence that the name did not come from the sender alone. */
const subjectNamesEmployer = (e: EffectiveEvent): boolean => {
  if (!e.company || !e.subject) return false;
  const norm = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const subj = ` ${norm(e.subject)} `;
  const words = norm(e.company).split(" ").filter((w) => w.length >= 4 && !["group", "company", "corporation", "international", "technologies", "services", "solutions", "systems", "careers", "talent"].includes(w));
  return words.length > 0 && words.some((w) => subj.includes(` ${w} `) || subj.includes(` ${w}s `));
};
export const weakEmployer = (e: EffectiveEvent) => !!e.company && !e.corrected && !e.confirmed && !subjectNamesEmployer(e) && (e.signals.includes("employer:sender-only") || (e.fieldConfidence?.company ?? 1) < 0.45);
/** "Corvid" is an alias of "Corvid Systems": the shorter name's words are a leading part of the longer one's, and the longer adds at most two words. Equal names are the strict case, not this one. */
export function employerAlias(a: string | null | undefined, b: string | null | undefined): boolean {
  const toks = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const x = toks(a ?? ""), y = toks(b ?? "");
  if (x.length === 0 || y.length === 0 || x.length === y.length) return false;
  // an acronym is the same name as its spelled-out form (TMCF / Thurgood Marshall College Fund)
  const initials = (t: string[]) => t.map((w) => w[0]).join("");
  if ((x.length === 1 && y.length >= 3 && x[0].length >= 3 && x[0] === initials(y)) || (y.length === 1 && x.length >= 3 && y[0].length >= 3 && y[0] === initials(x))) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return long.length - short.length <= 2 && short.every((t, i) => t === long[i]) && short.join("").length >= 4;
}
/** The role a message had BEFORE identity stripped a borrowed one (its cycle is still evidence). */
const borrowedRole = new WeakMap<object, string>();
const eventCycle = (e: EffectiveEvent, ctx?: IdentityContext): Cycle => {
  const own = cycleOf(e.role);
  if (own.years.length > 0 || !ctx?.borrowedCycle) return own;
  const b = borrowedRole.get(e);
  return b ? cycleOf(b) : own;
};
/** An APPLIED event is a receipt only when its subject says so; an availability confirmation, a portal code or a kickoff message typed "applied" is not another application. */
const RECEIPT_WORDS = /(appl|candidat|solicitud|bewerbung|postulaci|received|recib|recebid|eingang|bestätig|confirm|thank|danke|gracias|obrigad|merci|grazie)/i;
const NOT_RECEIPT = /\b(?:important information|information about your application|communication|preferences?|subscri\w*|newsletter|availability|interview|assessment|reminder|portal|access code|security code|verif\w*|survey|kick-?off|welcome|onboarding|orientation|agenda|schedule[d]?)\b/i;
export const receiptLike = (e: EffectiveEvent) => !e.subject || (RECEIPT_WORDS.test(e.subject) && !NOT_RECEIPT.test(e.subject));
const SEASON_END: Record<string, [number, number]> = { spring: [5, 30], summer: [7, 31], fall: [11, 31], winter: [2, 31] }; // [month index, day]
const PROCESS_TYPES = new Set<EventType>(["applied", "assessment", "assessment_completed", "interview_invite", "interview_scheduled", "offer"]);
/** The group's single recruiting cycle is over for hiring purposes: its latest season ended more than 30 days before this event. */
const cycleOver = (g: Group, e: EffectiveEvent): boolean => {
  const c = groupCycle(g); if (c.years.length !== 1 || c.seasons.length === 0) return false;
  const ends = c.seasons.map((s) => SEASON_END[s]).filter(Boolean).map(([m, d]) => Date.UTC(c.years[0], m, d)); if (ends.length === 0) return false;
  return e.occurredAt.getTime() > Math.max(...ends) + 30 * DAY;
};
const isHack = (e: EffectiveEvent) => /hackathon/i.test(e.subject ?? "");
export const specific = (role: string | null | undefined) => !!role && !isRoleFragment(role) && roleCore(role).length > 0;
export const isSpecificRole = specific;
/** Two role names that can never be the same application whatever they are called: a different recruiting cycle or programme type. Never overruled by a role-equivalence judgment. */
export const rolesHardConflict = (a: string, b: string): boolean => cyclesConflict(cycleOf(a), cycleOf(b)) || programsConflict(a, b);
/** Optional extra evidence for grouping. Absent, grouping is exactly what it always was. */
export type IdentityContext = {
  roleVerdicts?: RoleVerdicts;
  /** Phase 2: a name that only names the sender does not keep a message from joining the application it replies to in the same Gmail thread. Off by default (production grouping is unchanged). */
  weakEmployerThreads?: boolean;
  /** Phase 2: a role-less receipt in a DIFFERENT Gmail thread is another application whatever the gap in time (one receipt per application; a repeat delivery shares its thread). Off by default. */
  distinctThreadReceipts?: boolean;
  /** Phase 2: an employer's confirmation of an ending (a rejection or withdrawal) joins an application that has already ended, when its specific role matches, instead of starting a new one. Off by default. */
  confirmEndings?: boolean;
  /** Phase 2: evidence-scored attribution (see `attribute`). When a message's own employer name has no application at all, it is attributed to ONE existing application only when several independent
   *  kinds of evidence agree (employer, a specific role, a requisition number, a team, the Gmail thread, sender continuity) and nothing vetoes it. Otherwise it stays separate; a weaker best
   *  candidate is recorded as a low-priority suggestion with the reasons. No link is ever made from an employer-name resemblance alone. */
  attribution?: boolean;
  /** A role COPIED from another message is not evidence about which job a message is, but the recruiting cycle it states (the year and season) still is: a message whose thread says "Summer 2027" cannot join an application for "Summer 2026". */
  borrowedCycle?: boolean;
  /** A process event with no cycle of its own cannot join an application whose recruiting season ended more than a month earlier: a new process started. */
  cycleEnded?: boolean;
};
export function groupCycle(g: Group): Cycle {
  const years = new Set<number>(), seasons = new Set<string>();
  for (const e of g.events) { const c = cycleOf(e.role); c.years.forEach((y) => years.add(y)); c.seasons.forEach((s) => seasons.add(s)); }
  return { years: [...years].sort(), seasons: [...seasons].sort() };
}
const lastAt = (g: Group) => g.events[g.events.length - 1].occurredAt.getTime();
const endedByEmployerOrUser = (g: Group) => { const last = [...g.events].reverse().find((e) => STAGE_BEARING.has(e.type)); return last?.type === "rejection" || last?.type === "withdrawn"; };

/**
 * An externship is not an internship even when the event says only "Internship". A stated role whose program markers differ from the group's conflicts; a role that
 * states no program conflicts only when it names the default one ("intern"/"internship") against a group that is a named program, or the reverse.
 */
function programConflictWithGroup(g: Group, e: EffectiveEvent): boolean {
  if (!e.role || isRoleFragment(e.role)) return false;
  const gp = new Set(g.events.flatMap((x) => (x.role && !isRoleFragment(x.role) ? programsOf(x.role) : [])));
  const ep = programsOf(e.role);
  const names = (r: string) => /\bintern(?:ship)?s?\b/i.test(r);
  if (ep.length > 0 && gp.size > 0) return !ep.some((p) => gp.has(p));
  if (ep.length === 0 && gp.size > 0) return names(e.role);
  if (ep.length > 0 && gp.size === 0) return g.events.some((x) => x.role && !isRoleFragment(x.role) && names(x.role));
  return false;
}

/** Programme markers a message SUBJECT names ("Externship Headshot", "Fellowship call"): the strong, non-default programme types only. */
const SUBJECT_PROGRAMS = new Set(["externship", "fellowship", "apprenticeship", "hackathon", "symposium"]);
const subjectProgramsOf = (e: EffectiveEvent): string[] => [...new Set([...(e.subject ? programsOf(e.subject) : []), ...(e.role && !isRoleFragment(e.role) ? programsOf(e.role) : [])].filter((p) => SUBJECT_PROGRAMS.has(p)))];
/** A message whose subject names one programme type does not join a group that is another programme type (an Externship's travel and reimbursement mail is not the 2027 Internship). */
function subjectProgramConflict(g: Group, e: EffectiveEvent): boolean {
  const ep = subjectProgramsOf(e);
  if (ep.length === 0) {
    // the reverse: an event that names the default programme ("Internship") does not join a group whose own mail names another programme type
    if (!e.role || isRoleFragment(e.role) || !/\bintern(?:ship)?s?\b/i.test(e.role) || programsOf(e.role).length > 0) return false;
    return g.events.some((x) => subjectProgramsOf(x).length > 0);
  }
  const gp = new Set(g.events.flatMap((x) => [...subjectProgramsOf(x), ...(x.role && !isRoleFragment(x.role) ? programsOf(x.role).filter((p) => SUBJECT_PROGRAMS.has(p)) : [])]));
  if (gp.size > 0) return !ep.some((p) => gp.has(p));
  return g.events.some((x) => x.role && !isRoleFragment(x.role) && /\bintern(?:ship)?s?\b/i.test(x.role) && programsOf(x.role).length === 0);
}
/** The message's subject names a programme type that the group already is: that agreement outweighs a generic "Internship" role the reader filled in. */
function subjectProgramAgrees(g: Group, e: EffectiveEvent): boolean {
  const ep = subjectProgramsOf(e);
  if (ep.length === 0) return false;
  return g.events.some((x) => [...subjectProgramsOf(x), ...(x.role && !isRoleFragment(x.role) ? programsOf(x.role) : [])].some((p) => ep.includes(p)));
}

/** The hiring unit a message names ("the Controls team"), from the `unit:` signal the reader recorded. */
const unitOf = (e: EffectiveEvent): string | null => e.signals.find((x) => x.startsWith("unit:"))?.slice(5) ?? null;
const unitsOf = (g: Group): Set<string> => new Set(g.events.map(unitOf).filter((u): u is string => !!u));
const unitsMatch = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);

export type Relation = "match" | "generic" | "conflict";
/** The names an event or a group states in its own words (employer named by the message, or a confident stored company). */
const statedEmployers = (xs: EffectiveEvent[]) => new Set(xs.flatMap((x) => (x.signals.filter((q) => q.startsWith("employer:named:")).map((q) => companyKey(q.slice(15))))));
/** Both sides name an employer in their own words and the names are different organisations (not an alias, not an acronym): a hard identity conflict. */
function namesOtherEmployer(g: Group, e: EffectiveEvent): boolean {
  const mine = statedEmployers([e]); const theirs = statedEmployers(g.events);
  if (mine.size === 0 || theirs.size === 0) return false;
  const fullName = (k: string) => g.events.map((x) => x.signals.find((q) => q.startsWith("employer:named:") && companyKey(q.slice(15)) === k)?.slice(15)).find(Boolean) ?? k;
  return [...mine].every((m) => ![...theirs].some((t) => t === m || employerAlias(fullName(t), e.signals.find((q) => q.startsWith("employer:named:"))?.slice(15) ?? m)));
}
const receiptRoleOf = (x: EffectiveEvent) => (x.type === "applied" && x.signals.includes("own:receipt") ? x.signals.find((q) => q.startsWith("role:named:"))?.slice(11) ?? null : null);
/** Two explicit receipts name two different positions: two applications, however much wording or thread they share ("one receipt is sent per application"). Same position = equal core words, or one core inside the other with at most one extra word. */
function differentReceiptRoles(g: Group, e: EffectiveEvent): boolean {
  const mine = receiptRoleOf(e); if (!mine) return false;
  const a = new Set(roleCore(mine));
  if (a.size === 0) return false;
  return g.events.some((x) => {
    const theirs = receiptRoleOf(x); if (!theirs) return false;
    const b = new Set(roleCore(theirs)); if (b.size === 0) return false;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    const inside = [...small].every((t) => big.has(t));
    return !(inside && big.size - small.size <= 1);
  });
}
/** How an event relates to an established opportunity, from role, cycle and program alone (time and thread are weighed by the caller). */
export function relation(g: Group, e: EffectiveEvent, ctx?: IdentityContext, corroborated = false): Relation {
  const ec = eventCycle(e, ctx);
  if (cyclesConflict(groupCycle(g), ec)) return "conflict";
  // hard identity vetoes that no thread, sender or generic wording can override: different organisations named in the messages' own words, or two explicit receipts for different positions
  if (ctx?.attribution && (namesOtherEmployer(g, e) || differentReceiptRoles(g, e))) return "conflict";
  // programme journeys: the programme's own name (stamped from its own words) is its identity; two messages that carry the same programme name are one programme even when every word of it is generic
  const progName = (x: EffectiveEvent) => x.signals.some((q) => q === "program:named" || q.startsWith("program:evidence:"));
  if (ctx?.attribution && progName(e) && e.role && g.events.some((x) => progName(x) && x.role && x.role.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === e.role!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) return "match";
  if (programConflictWithGroup(g, e) && !(ctx?.attribution && subjectProgramAgrees(g, e))) return "conflict";
  // (a subject that names another programme type does not outweigh the very Gmail thread the group already holds: replies keep the subject of the message they answer)
  if (ctx?.attribution && !(corroborated && g.threads.has(e.gmailThreadId)) && subjectProgramConflict(g, e)) return "conflict";
  if (ctx?.attribution && ((isHack(e) && g.events.every((x) => !isHack(x))) || (!isHack(e) && g.events.every(isHack)))) return "conflict"; // a hackathon application is not the employer's job application
  // (Phase 2) A requisition / job reference number is identity: the same number is the same application, and two different numbers are two applications, whatever the wording says.
  // (Phase 2) The same appointment is the same application: an interview at one employer at the same scheduled moment (a calendar invitation and the email about it, or a reminder) is one process.
  if (ctx?.attribution && e.eventDateHasTime && e.eventDate && (e.type === "interview_scheduled" || e.type === "interview_invite") && g.events.some((x) => x.eventDateHasTime && x.eventDate && x.eventDate.getTime() === e.eventDate!.getTime() && (x.type === "interview_scheduled" || x.type === "interview_invite"))) return "match";
  if (ctx?.attribution) { const er = reqOf(e); const gr = new Set(g.events.map(reqOf).filter((x): x is string => !!x)); if (er && gr.size > 0) return gr.has(er) ? "match" : "conflict"; }
  // The hiring unit is soft identity evidence: at one employer, two applications to different units are different applications, and a message naming the unit one of them
  // is for belongs to it. Only when BOTH sides name a unit; a side that names none says nothing.
  const eu = unitOf(e), gu = unitsOf(g);
  // (a hiring unit is soft evidence: the very Gmail thread the group already holds outweighs it, and a unit that is only the employer's own name or a person's name says nothing)
  if (eu && gu.size > 0 && !(corroborated && ctx?.attribution)) return [...gu].some((u) => unitsMatch(u, eu)) ? (specific(e.role) && g.events.some((x) => specific(x.role)) && !g.events.some((x) => specific(x.role) && roleRelationV2(x.role, e.role) === "match") ? "conflict" : "match") : "conflict";
  if (!specific(e.role)) return "generic";
  const roles = g.events.map((x) => x.role).filter((r): r is string => specific(r));
  if (roles.length === 0) return "generic";
  // A semantic judgment that two role NAMES refer to the same job (or different jobs) replaces the token comparison for that pair; hard conflicts (cycle, programme) still apply.
  const ok = roles.some((r) => {
    const verdict = ctx?.roleVerdicts?.get(rolePairKey(r, e.role!));
    // Asymmetric on purpose: "different" may always keep two applications apart, but "same" may only JOIN them when an independent signal (the Gmail thread) agrees. A wrong merge hides an
    // application; a wrong split is visible and can be linked by a person.
    const rel = verdict === "different" ? "conflict" : verdict === "same" && corroborated ? "match" : roleRelationV2(r, e.role);
    return rel === "match" && !programsConflict(r, e.role) && !cyclesConflict(cycleOf(r), ec);
  });
  // a role that differs in wording (not in programme or season) from the group's, inside the very Gmail thread the group holds, is the same conversation's looser name for it, not another opportunity
  if (!ok && corroborated && ctx?.attribution && g.threads.has(e.gmailThreadId) && !roles.some((r) => programsConflict(r, e.role!) || cyclesConflict(cycleOf(r), ec))) return "generic";
  return ok ? "match" : "conflict";
}

/** Two receipts that state the SAME requisition, or the same specific role within half a day, are one application's confirmations (a portal and a mailbox both write), not two applications. */
const repeatDelivery = (x: EffectiveEvent, e: EffectiveEvent) => (!!reqOf(e) && reqOf(e) === reqOf(x)) || (specific(e.role) && specific(x.role) && Math.abs(e.occurredAt.getTime() - x.occurredAt.getTime()) < DAY / 2 && roleRelationV2(x.role!, e.role!) === "match");

const isProgAcc = (x: EffectiveEvent) => x.signals.includes("class:program-acceptance");
const isClassed = (x: EffectiveEvent) => x.signals.some((q) => /^class:(?:event|survey|notice|community|marketing)$/.test(q));

export function allowed(g: Group, e: EffectiveEvent, rel: Relation, viaThread: boolean, ctx?: IdentityContext): boolean {
  if (rel === "conflict") return false;
  // event, survey, notice and community messages (message-class signals) cluster with each other, never with an application's own mail, unless the same Gmail thread ties them to it
  if (ctx?.attribution && !viaThread && !e.linkedTo && !e.confirmed && !e.signals.some((q) => q.startsWith("program:evidence:") || q === "program:named" || /^program:(?:completed|removed|awarded|accepted|enrolled)$/.test(q)) && !g.events.some((x) => x.signals.some((q) => q === "program:named" || q.startsWith("program:evidence:"))) && isClassed(e) !== g.events.every(isClassed)) return false;
  // a programme acceptance is a programme journey of its own: it never joins a job application's group (and a job's events never join a group of programme acceptances) unless the same Gmail thread ties them
  if (ctx?.attribution && !viaThread && !e.linkedTo && !e.confirmed && isProgAcc(e) !== g.events.every(isProgAcc) && !e.signals.some((q) => q === "program:named" || q.startsWith("program:evidence:")) && !g.events.some((x) => x.signals.some((q) => q === "program:named" || q.startsWith("program:evidence:")))) return false;
  // a new application after a rejection is a new opportunity; but progress (an assessment, an interview, an offer) in the SAME thread for a compatible role is
  // far more often the same process continuing than a new one, so it joins and the contradiction is surfaced for a person (lib/lifecycle/contradictions.ts)
  // a message that takes the employer's own ending back ("please disregard our previous message") continues that process whatever type it was read as
  const retraction = e.signals.includes("retraction (fact)");
  // (Phase 2) the employer confirming an ending that is already recorded (a rejection after the student's withdrawal, a second notice of the same rejection) is the same application, not a new one
  const confirmsEnding = !!ctx?.confirmEndings && rel === "match" && (e.type === "rejection" || e.type === "withdrawn") && (viaThread || e.occurredAt.getTime() - lastAt(g) <= 30 * DAY);
  if (endedByEmployerOrUser(g) && !NEUTRAL.has(e.type) && !retraction && !confirmsEnding && !(viaThread && REOPENS.has(e.type))) return false;
  // a message that states a requisition number starts or continues THAT application: it does not join a group made only of uncorroborated model readings (event invitations, outreach) that states none
  if (ctx?.attribution && reqOf(e) && g.events.every((x) => !reqOf(x) && x.signals.includes("semantic:event") && !x.signals.includes("entry:corroborated") && !x.corrected && !x.confirmed)) return false;
  const gap = e.occurredAt.getTime() - lastAt(g);
  if (rel === "generic" && ctx?.cycleEnded && PROCESS_TYPES.has(e.type) && cycleOver(g, e)) return false;
  // a subject that names the group's own programme type ("Externship Call" for an externship) is stronger than the generic window
  if (rel === "generic" && ctx?.attribution && subjectProgramAgrees(g, e)) return gap <= SPECIFIC_WINDOW_NO_CYCLE;
  if (rel === "generic") return gap <= (viaThread ? GENERIC_WINDOW_WITH_THREAD : GENERIC_WINDOW);
  // a role-matched message with no cycle of its own, long after the group's single recruiting season ended, outside any shared thread: a new cycle's mail, not the old application
  if (!viaThread && ctx?.cycleEnded && eventCycle(e, ctx).years.length === 0 && cycleOver(g, e)) return false;
  if (viaThread) return true;
  const gc = groupCycle(g), ec = eventCycle(e, ctx);
  const positiveCycle = gc.years.length > 0 && ec.years.length > 0; // already known not to conflict, so they share a year
  return positiveCycle || gap <= SPECIFIC_WINDOW_NO_CYCLE;
}

/**
 * Lifecycle consistency as identity evidence. Some message types can only continue a process that is waiting for them: a finished assessment follows an assessment that was
 * sent, a confirmed interview follows an invitation. Among several candidate applications at one employer, the ones whose latest step does not lead to this message are not
 * candidates; if exactly one is left, the message belongs to it. Used ONLY to break a tie that role, cycle and thread could not; never to override them.
 */
const LEADS_TO: Partial<Record<EventType, EventType[]>> = {
  assessment_completed: ["assessment"],
  interview_scheduled: ["interview_invite", "recruiter_outreach"],
};
function awaiting(g: Group, e: EffectiveEvent): boolean {
  const need = LEADS_TO[e.type];
  if (!need) return true;
  const last = [...g.events].reverse().find((x) => STAGE_BEARING.has(x.type));
  return !!last && need.includes(last.type);
}
function breakTieByLifecycle<T extends { g: Group }>(candidates: T[], e: EffectiveEvent): T | null {
  if (!LEADS_TO[e.type]) return null;
  const fit = candidates.filter(({ g }) => awaiting(g, e));
  return fit.length === 1 ? fit[0] : null;
}

/**
 * More evidence for a tie between candidate applications, each independent of role extraction and used ONLY when exactly one candidate stands out:
 *  - the message's own subject names the program/role words one candidate carries ("... 2026 R&D Externship Interview" for "2026 R&D Innovate Boldly Externship"):
 *    at least two shared meaningful words and a strict lead over every other candidate;
 *  - the same sender (display name and domain) wrote a message of exactly one candidate within the previous 45 days (a reminder or confirmation follows its invitation).
 */
const SUBJECT_STOP = new Set(["intern", "internship", "interns", "the", "and", "for", "with", "your", "our", "you", "application", "applications", "update", "reminder", "interview", "invitation", "invite", "confirmation", "confirmed", "next", "step", "steps", "schedule", "scheduled", "re", "fw", "fwd", "details", "new", "important", "action", "required", "program", "role", "position", "job"]);
const words = (text: string | null | undefined) => new Set((text ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9&]+/).filter((w) => w.length >= 3 && !SUBJECT_STOP.has(w)));
function breakTieByEvidence<T extends { g: Group }>(candidates: T[], e: EffectiveEvent): T | null {
  const subjectWords = words(e.subject);
  if (subjectWords.size > 0) {
    const scored = candidates.map((c) => {
      const roleWords = new Set(c.g.events.flatMap((x) => [...words(x.role)]));
      return { c, n: [...subjectWords].filter((w) => roleWords.has(w)).length };
    }).sort((a, b) => b.n - a.n);
    if (scored[0] && scored[0].n >= 2 && (scored.length === 1 || scored[0].n > scored[1].n)) return scored[0].c;
  }
  if (e.senderName && e.senderDomain) {
    const same = candidates.filter(({ g }) => g.events.some((x) => !x.outbound && x.senderName === e.senderName && x.senderDomain === e.senderDomain && Math.abs(e.occurredAt.getTime() - x.occurredAt.getTime()) <= 45 * DAY));
    if (same.length === 1) return same[0];
  }
  return null;
}
const breakTie = <T extends { g: Group }>(candidates: T[], e: EffectiveEvent): T | null => breakTieByEvidence(candidates, e) ?? breakTieByLifecycle(candidates, e);

const reqOf = (e: EffectiveEvent): string | null => e.signals.find((x) => x.startsWith("req:"))?.slice(4) ?? (e.subject ? requisitionOf(e.subject) : null); // the subject is stored; a number it states needs no stamp
const strongRole = (r: string | null | undefined) => specific(r) && roleCore(r).length >= 2;
const companyKeyEq = (g: Group, e: EffectiveEvent) => !!g.company && !!e.company && companyKey(g.company) === companyKey(e.company);
const COMMON_ROLE_WORDS = new Set(["intern", "internship", "summer", "winter", "spring", "fall", "autumn", "software", "engineer", "engineering", "program", "programme", "student", "research", "analyst", "developer", "data", "science", "scientist", "associate", "undergraduate", "graduate", "technology", "technical", "product", "design", "business", "digital", "global", "early", "career", "campus", "junior", "senior", "applied", "general", "operations", "finance", "marketing", "opportunity", "opportunities", "position", "role", "full", "time", "part"]);
const COMMON_ACRONYMS = new Set(["swe", "sde", "sre", "usa", "api", "aws", "php", "sql", "ios", "nyc", "bay", "hbcu", "stem", "gpa", "cpt", "opt", "remote", "hybrid"]);
/** Distinctive = an ACRONYM in the role as written ("LCLS", "REU", "KPCB"): a name of a programme, not a title word, not an ordinary English word, and not a common role acronym. */
const distinctiveWords = (role: string | null | undefined) => new Set(((role ?? "").match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !COMMON_ACRONYMS.has(w) && !COMMON_ROLE_WORDS.has(w)));
/** Two employer NAMES (a university and its laboratory) over one programme: they share a distinctive role word (not a title word), the same recruiting cycle, and no conflicting requisition. */
function sharesDistinctiveRole(g: Group, e: EffectiveEvent, ctx?: IdentityContext): boolean {
  if (!ctx?.attribution || !specific(e.role)) return false;
  const mine = distinctiveWords(e.role);
  if (mine.size === 0) return false;
  const groupWords = distinctiveWords(groupRole(g));
  const shared = [...mine].filter((w) => groupWords.has(w));
  if (shared.length === 0) return false;
  if (cyclesConflict(groupCycle(g), cycleOf(e.role))) return false;
  const er = reqOf(e), gr = new Set(g.events.map(reqOf).filter((x): x is string => !!x));
  if (er && gr.size > 0 && !gr.has(er)) return false;
  return Math.abs(e.occurredAt.getTime() - lastAt(g)) <= 14 * DAY;
}
/** Hosts that many unrelated organisations share: a platform, a mail service or a scheduler says nothing about WHO is writing. */
const SHARED_HOST = /\.(?:greenhouse(?:-mail)?|lever|hire\.lever|myworkday(?:jobs)?|workday|smartrecruiters|icims|ashbyhq|ashby|taleo|jobvite|successfactors|brassring|avature|dayforce|paylocity|oraclecloud|eightfold|phenom|recruitee|breezy|workable|bamboohr|hirevue|codesignal|hackerrank|gmail|googlemail|outlook|google|zoom|calendly|linkedin|handshake|ripplematch|slack|eventbrite|luma|mailchimp|hubspot|typeform|substack|notion|discord|meetup|salesforce|forage)\./i;
export type Attribution = { link: Group | null; suggest: Group | null; score: number; reasons: string[] };
/**
 * Evidence-scored attribution of a message to one of several candidate applications (Phase 2). Each candidate is scored on independent kinds of evidence; a hard conflict (a different cycle,
 * programme, team, specific role or requisition) removes it. It LINKS only when the best candidate has at least two independent kinds of evidence, a score of 3.5, and a lead of 1.5 over the
 * runner-up; a weaker best candidate becomes a suggestion; employer-name resemblance alone is worth 1 and can never reach the bar.
 */
export function attribute(groups: Group[], e: EffectiveEvent, ctx?: IdentityContext): Attribution {
  const scored: { g: Group; score: number; kinds: Set<string>; reasons: string[] }[] = [];
  const er = reqOf(e);
  for (const g of groups) {
    if (!g.company || lastAt(g) < e.occurredAt.getTime() - 90 * DAY) continue;
    if (relation(g, e, ctx) === "conflict" || !allowed(g, e, "match", false, ctx)) continue;
    const reqs = new Set(g.events.map(reqOf).filter((x): x is string => !!x));
    if (er && reqs.size > 0 && !reqs.has(er)) continue; // a different requisition is a different application
    let score = 0; const kinds = new Set<string>(), reasons: string[] = [];
    const add = (kind: string, pts: number, why: string) => { score += pts; kinds.add(kind); reasons.push(why); };
    if (er && reqs.has(er)) add("requisition", 3, "same requisition");
    if (e.company && companyKey(g.company) === companyKey(e.company)) add("employer", 2, "same employer");
    else if (e.company && employerAlias(g.company, e.company)) add("employer", weakEmployer(e) || g.events.every((x) => !x.company || weakEmployer(x)) ? 2 : 1, "employer name is a form of the same name");
    else if (e.company && sharesDistinctiveRole(g, e, ctx)) { add("program-token", 2, "the same distinctive programme/role word under two employer names"); if (Math.abs(e.occurredAt.getTime() - lastAt(g)) <= 7 * DAY) add("timing", 1, "within a week"); }
    // an application receipt with no stated role of its own, from the same institutional host that wrote the group's receipt within days: one application receipted twice under two names of one organisation
    else if (e.company && ctx?.attribution && e.type === "applied" && e.signals.includes("own:receipt") && !namesOtherEmployer(g, e) && e.senderDomain && !SHARED_HOST.test(`.${e.senderDomain}`) && Math.abs(e.occurredAt.getTime() - lastAt(g)) <= 3 * DAY
      && g.events.some((x) => !x.outbound && x.type === "applied" && x.senderDomain === e.senderDomain)) { add("host", 2, "the same institutional host receipted the same application within days"); add("timing", 1, "within days"); }
    else if (!weakEmployer(e) && e.company && !g.events.every((x) => !x.company || weakEmployer(x))) continue; // two confident, different employers
    // a message that states the LONGER form of the employer name ("Claude Corps" in a receipt for "Claude", whose rejection comes from "Claude Corps Fellowship") is evidence for the alias
    if (e.company && employerAlias(g.company, e.company)) {
      const [short, long] = g.company.length < e.company.length ? [g.company, e.company] : [e.company, g.company];
      const toks = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
      const phrase = toks(long).slice(0, toks(short).length + 1).join(" ");
      if ([...g.events, e].some((x) => toks(x.subject ?? "").join(" ").includes(phrase))) add("name", 2, "a message names the longer employer form");
    }
    const gr = groupRole(g);
    if (strongRole(e.role) && strongRole(gr) && roleRelationV2(gr!, e.role) === "match") add("role", 2, "same specific role");
    else if (specific(e.role) && specific(gr) && roleRelationV2(gr!, e.role) === "match") add("role-weak", 0.5, "similar generic role");
    const eu = unitOf(e), gu = unitsOf(g);
    if (eu && [...gu].some((u) => unitsMatch(u, eu))) add("team", 1, "same team");
    if (g.threads.has(e.gmailThreadId)) add("thread", 2, "same Gmail thread");
    if (e.senderName && g.events.some((x) => !x.outbound && x.senderName === e.senderName && x.senderDomain === e.senderDomain && Math.abs(e.occurredAt.getTime() - x.occurredAt.getTime()) <= 45 * DAY)) add("sender", 1, "same sender");
    // the same institutional sender host (not a shared platform) writing about the same distinctive programme/role word under two names of one organisation (a university and its laboratory)
    if (kinds.has("program-token") && e.senderDomain && !SHARED_HOST.test(`.${e.senderDomain}`) && g.events.some((x) => !x.outbound && x.senderDomain === e.senderDomain)) add("host", 1, "same sender host");
    // mail arriving within days of the application's own, from a name that is a form of its employer: one burst of mail about one application, not a coincidence of names
    if (kinds.has("employer") && !companyKeyEq(g, e) && Math.abs(e.occurredAt.getTime() - lastAt(g)) <= 3 * DAY) add("timing", 1, "arrived within days");
    if (e.occurredAt.getTime() - lastAt(g) <= 30 * DAY) score += 0.5;
    scored.push({ g, score, kinds, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0], second = scored[1];
  if (!best) return { link: null, suggest: null, score: 0, reasons: [] };
  const independent = [...best.kinds].filter((k) => k !== "role-weak").length;
  const link = best.score >= 3.5 && independent >= 2 && best.score - (second?.score ?? 0) >= 1.5;
  return { link: link ? best.g : null, suggest: !link && best.score >= 2 ? best.g : null, score: best.score, reasons: best.reasons };
}

/** Signals that mark a role the reader COPIED from another message (the thread's first one, or an earlier message from the same sender) instead of reading it from this one. */
const BORROWED_ROLE = ["role-inherited", "reply-in-recruiting-thread", "known-contact-continuity", "outbound-in-recruiting-thread"];
export function groupEventsV2(input: EffectiveEvent[], ctx?: IdentityContext): Group[] {
  // A role the reader COPIED from an earlier message ("role-inherited", or a reply/continuity event that took its anchor's role) is not evidence about THIS message: automated senders reuse one thread for several
  // roles, so an inherited role would pull a role-less message into whichever application the thread started with. For identity such an event states no role.
  const original = new Map(input.map((e) => [e.id, e] as const));
  const events = input.map((e0) => {
    // a position the message itself names ("…for the Internship - Digital, North America position") is the role for identity when the stored role is generic
    // (it outranks a stored role that is generic, that the reader copied from another message, or that the receipt itself contradicts: a receipt names the opportunity it receipts)
    const namedSig = ctx?.attribution && !e0.corrected && !e0.confirmed ? e0.signals.find((x) => x.startsWith("role:named:"))?.slice(11) : undefined;
    const named = namedSig && (!specific(e0.role) || BORROWED_ROLE.some((x) => e0.signals.includes(x)) || (e0.signals.includes("own:receipt") && e0.role && roleRelationV2(e0.role, namedSig) !== "match")) ? namedSig : undefined;
    const e = named && specific(named) ? { ...e0, role: named } : e0;
    if (BORROWED_ROLE.some((x) => e.signals.includes(x)) && !e.corrected && !e.confirmed && !named) { const stripped = { ...e, role: null }; if (e.role) borrowedRole.set(stripped, e.role); return stripped; }
    return e;
  });
  const restore = (g: Group[]) => { for (const x of g) x.events = x.events.map((e) => (original.get(e.id) ? { ...e, role: original.get(e.id)!.role } : e)); return g; };
  // An event the investigation attached to a specific application (`identity:attach:<anchor event id>`) is placed AFTER the groups exist, in the group that holds its anchor, whatever the dates say
  // (a reply that preceded the application's first message still belongs to it). With no such group it falls back to the ordinary pass.
  const attachOf = (e: EffectiveEvent) => e.signals.find((x) => x.startsWith("identity:attach:"))?.slice(16);
  const anchorIds = new Set(events.map((e) => e.id));
  const deferred = events.filter((e) => { const a = attachOf(e); return !!a && anchorIds.has(a) && a !== e.id; });
  const deferredIds = new Set(deferred.map((e) => e.id));
  const sorted = events.filter((e) => !deferredIds.has(e.id)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  // a person's "belongs with" constraints form components; an event in a component whose group exists joins it directly
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; return p === x ? x : (parent.set(x, find(p)), parent.get(x)!); };
  const ids = new Set(sorted.map((e) => e.id));
  for (const e of sorted) if (e.linkedTo && e.linkedTo !== e.id && ids.has(e.linkedTo)) parent.set(find(e.id), find(e.linkedTo));
  const componentGroup = new Map<string, Group>();

  const groups: Group[] = [];
  const byThread = new Map<string, Group>();
  for (let e of sorted) {
    let target: Group | undefined = parent.has(e.id) || [...parent.values()].includes(e.id) ? componentGroup.get(find(e.id)) : undefined;
    let ambiguous: string | null = null;
    let possibleLink: Group | null = null;
    if (!target && !e.separate) {
      const sameEmployer = (g: Group) => !e.company || !g.company || companyKey(g.company) === companyKey(e.company);
      // A name that is only WHO SENT the mail (a webmail or platform brand taken from the sender, never written in the message) is not evidence of a different employer. Within one Gmail
      // thread, where the thread itself is independent evidence, it must not keep a message from joining the application it replies to.
      const threadEmployerOk = (g: Group) => sameEmployer(g) || (!!ctx?.weakEmployerThreads && (weakEmployer(e) || g.events.every((x) => !x.company || weakEmployer(x))));
      // 1. the Gmail thread: evidence, weighed like any other. A thread can hold several opportunities (automated mail reuses one subject), so every group that
      //    has mail in this thread is a candidate and the same checks apply to each; a specific role match beats a generic one, then recency.
      // The employer NAME may differ inside one thread when the message names the host and the receipt the sender's organisation (a university and its laboratory; a firm and its fellows
      // programme): a name that is a form of the other's, or the SAME specific role (two or more role words) in the same Gmail thread, keeps the thread's evidence in play.
      const threadNamesDiffer = (g: Group) => !!ctx?.attribution && !!e.company && !!g.company && (employerAlias(g.company, e.company) || e.signals.includes("reply-in-recruiting-thread") || (specific(e.role) && specific(groupRole(g)) && roleRelationV2(groupRole(g)!, e.role) === "match"));
      const inThread = groups.filter((g) => g.threads.has(e.gmailThreadId) && (threadEmployerOk(g) || threadNamesDiffer(g))).map((g) => ({ g, rel: relation(g, e, ctx, true) })).filter(({ g, rel }) => allowed(g, e, rel, true, ctx));
      const threadMatches = inThread.filter((s) => s.rel === "match");
      const threadGenerics = inThread.filter((s) => s.rel === "generic");
      // ABSTAIN here too: a role-less message in a thread that already holds two applications for DIFFERENT roles cannot be told from either by the thread alone.
      const sig = (g: Group, i: number) => { const r = groupRole(g); return r && specific(r) ? roleCore(r).join(" ") : `#${g.events[0].id}:${i}`; };
      const threadRoles = new Set(threadGenerics.map(({ g }, i) => sig(g, i)));
      if (threadMatches.length === 0 && threadGenerics.length > 1 && threadRoles.size > 1 && !specific(e.role)) {
        const byLifecycle = breakTie(threadGenerics, e);
        if (byLifecycle) target = byLifecycle.g; else ambiguous = threadGenerics.map(({ g }) => groupRole(g) ?? "an application with no stated role").join(" / ");
        // a message that cannot close, advance or settle anything (a reminder, a bare status, a receipt, an outreach) rides with the latest candidate and says so; a stage-bearing one stays apart
        if (!target && !CONSEQUENTIAL.has(e.type)) target = threadGenerics.sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g;
      } else {
        target = threadMatches.sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g ?? threadGenerics.sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g;
      }
      if (!target && !ambiguous) {
        const pool = e.company
          ? groups.filter((g) => (g.company && companyKey(g.company) === companyKey(e.company!)) || (!!ctx?.attribution && g.events.some((x) => !!x.company && companyKey(x.company) === companyKey(e.company!) && !weakEmployer(x))))
          : e.senderDomain ? groups.filter((g) => !g.company && g.events.some((x) => x.senderDomain === e.senderDomain)) : [];
        const scored = pool.map((g) => ({ g, rel: relation(g, e, ctx) })).filter(({ g, rel }) => allowed(g, e, rel, false, ctx));
        const matches = scored.filter((s) => s.rel === "match");
        const generics = scored.filter((s) => s.rel === "generic");
        // a message whose subject names a programme type ("Externship Call") is attributed among the candidates that ARE that programme before the role-less abstention below applies
        const subjectNarrow = (list: typeof scored) => {
          if (!ctx?.attribution || subjectProgramsOf(e).length === 0) return list;
          const n = list.filter(({ g }) => subjectProgramAgrees(g, e));
          if (n.length === 0) return list;
          // several candidates are that programme: the one whose own specific role names it is the application itself, the others are fragments of its mail
          const named = n.filter(({ g }) => { const r = groupRole(g); return !!r && specific(r) && programsOf(r).some((p) => subjectProgramsOf(e).includes(p)); });
          return named.length === 1 ? named : n;
        };
        const pick = subjectNarrow(matches.length ? matches : generics);
        if (matches.length > 1 && !e.company) { /* employer-less with several role matches: fall through to the most recent */ }
        // ABSTAIN: an event that states no specific role, at an employer with two or more live applications for DIFFERENT roles, cannot be attributed by employer
        // alone. Joining the latest would be a guess that merges two applications; it stays on its own and says why.
        const roleSet = new Set(pick.map(({ g }, i) => { const r = groupRole(g); return r && specific(r) ? roleCore(r).join(" ") : `#${g.events[0].id}:${i}`; }));
        if (matches.length === 0 && subjectNarrow(generics).length > 1 && roleSet.size > 1 && !specific(e.role) && !(subjectNarrow(generics).length === 1)) {
          const byLifecycle = breakTie(generics, e);
          if (byLifecycle) target = byLifecycle.g; else ambiguous = generics.map(({ g }) => groupRole(g) ?? "an application with no stated role").join(" / ");
          if (!target && !CONSEQUENTIAL.has(e.type)) target = generics.sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g;
        } else {
          target = pick.sort((a, b) => lastAt(b.g) - lastAt(a.g))[0]?.g;
          // One receipt is sent per application: a role-less receipt in ANOTHER thread, when the candidate already holds a receipt from a different thread, starts another
          // application (two receipts in one thread, or a repeat delivery within hours, still join).
          if (target && e.type === "applied" && (!specific(e.role) || !!ctx?.distinctThreadReceipts) && (!ctx?.distinctThreadReceipts || receiptLike(e)) && target.events.some((x) => x.type === "applied" && x.gmailThreadId !== e.gmailThreadId && !repeatDelivery(x, e) && (!ctx?.distinctThreadReceipts || receiptLike(x)) && (ctx?.distinctThreadReceipts || Math.abs(e.occurredAt.getTime() - x.occurredAt.getTime()) >= DAY / 2)) && !target.threads.has(e.gmailThreadId)) target = undefined;
        }
        // (Phase 2) Evidence-scored attribution, only when this message's own employer name has no application at all (so it can never pull a message away from an exact-employer candidate).
        if (!target && !ambiguous && ctx?.attribution && pool.length === 0) {
          const att = attribute(groups, e, ctx);
          if (att.link) { target = att.link; e = { ...e, signals: [...e.signals, `identity:attributed:${att.reasons.join("+").replace(/ /g, "-")}`] }; }
          else if (att.suggest) possibleLink = att.suggest;
        }
        // An event whose employer is unknown, from an employer's own domain that exactly ONE existing opportunity has written from, belongs with it unless
        // role, cycle, program or the end of that opportunity say otherwise (the same weighing as any other link). Platforms, freemail and several candidates never link this way.
        if (!target && !ambiguous && !e.company && e.senderDomain && classifySender(e.senderDomain) === "employer") {
          const same = groups.filter((g) => g.events.some((x) => x.senderDomain === e.senderDomain));
          if (same.length === 1 && allowed(same[0], e, relation(same[0], e, ctx), false, ctx)) target = same[0];
        }
      }
    }
    if (ambiguous) e = { ...e, signals: [...e.signals, "identity:ambiguous"], reviewReasons: [...(e.reviewReasons ?? []), `identity: could belong to more than one application (${ambiguous})`] };
    // a weaker best candidate is only a SUGGESTION (low priority; whether it is worth asking about is decided by the review tiering, not here)
    if (possibleLink && !target) e = { ...e, signals: [...e.signals, `identity:suggest:${possibleLink.events[0].id}`] };
    if (!target) { target = { company: e.company, events: [], threads: new Set() }; groups.push(target); }
    target.events.push(e);
    target.threads.add(e.gmailThreadId);
    byThread.set(e.gmailThreadId, target);
    componentGroup.set(find(e.id), target);
    if (e.company && (!target.company || (!!ctx?.weakEmployerThreads && target.events.every((x) => !x.company || weakEmployer(x)) && !weakEmployer(e)))) target.company = e.company; // a name the message itself writes replaces one that only named the sender
  }
  for (const e of deferred) {
    const g = groups.find((x) => x.events.some((y) => y.id === attachOf(e)));
    if (!g) { groups.push({ company: e.company, events: [e], threads: new Set([e.gmailThreadId]) }); continue; }
    g.events.push(e); g.events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id)); g.threads.add(e.gmailThreadId);
  }
  return restore(groups);
}

/**
 * The title an opportunity shows: the latest SPECIFIC role stated with reasonable confidence, not the first one ever seen. Fragments of prose are never a title.
 * A role the person corrected always wins.
 */
export function groupRole(g: Group): string | null {
  const chrono = g.events;
  const corrected = [...chrono].reverse().find((e) => e.corrected && e.role);
  if (corrected) return corrected.role;
  const byConfidence = (min: number) => [...chrono].reverse().find((e) => specific(e.role) && (e.fieldConfidence?.role ?? 0.6) >= min);
  return byConfidence(0.5)?.role ?? byConfidence(0)?.role ?? [...chrono].reverse().find((e) => e.role && !isRoleFragment(e.role))?.role ?? null;
}
