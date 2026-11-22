import assert from "node:assert/strict";
import test from "node:test";
import { buildActions, DORMANT_AFTER_DAYS } from "../recruiting/actions.ts";
import { buildBriefing } from "../recruiting/briefing.ts";
import { parseCorrection, serializeCorrection } from "../recruiting/corrections.ts";
import { applyCorrection, buildOpportunities } from "../recruiting/opportunity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { cycleOf, cyclesConflict, isRoleFragment, programsOf, roleRelationV2 } from "./cycle.ts";
import { groupEventsV2 } from "./identity.ts";
import { reduceLifecycle } from "./reducer.ts";
// these tests cover the elapsed-time nudges, which are OFF by default (ELAPSED_NUDGES=on is the rollback mode); lib/recruiting/actions-no-elapsed.test.ts covers the default
process.env.ELAPSED_NUDGES = "on";
import { repairText } from "./text.ts";

let n = 0;
const base = Date.UTC(2026, 0, 1);
const ev = (o: { id?: string; type: EventType; role?: string | null; day: number; thread?: string; company?: string; fc?: number; signals?: string[]; corrected?: boolean; confirmed?: boolean; date?: number; linkedTo?: string; separate?: boolean; outbound?: boolean }): EffectiveEvent => {
  const id = o.id ?? `e${++n}`;
  return {
    id, gmailMessageId: id, gmailThreadId: o.thread ?? `t-${id}`, occurredAt: new Date(base + o.day * 86_400_000), outbound: o.outbound ?? o.type === "user_reply", senderName: "x", senderDomain: "acme.example", subject: "s",
    type: o.type, company: o.company ?? "Acme", role: o.role ?? null, eventDate: o.date === undefined ? null : new Date(base + o.date * 86_400_000), eventDateHasTime: false, dateKind: o.date === undefined ? null : "deadline",
    confidence: o.fc ?? 0.9, fieldConfidence: { type: o.fc ?? 0.9, company: 0.9, role: 0.6 }, reviewReasons: [], signals: o.signals ?? [], corrected: o.corrected ?? false, ...(o.confirmed ? { confirmed: true } : {}), ...(o.linkedTo ? { linkedTo: o.linkedTo } : {}), ...(o.separate ? { separate: true } : {}),
  };
};
const ids = (gs: ReturnType<typeof groupEventsV2>) => gs.map((g) => g.events.map((e) => e.id).sort());

test("cycle: years and seasons are identity; overlapping sets are one cycle", () => {
  assert.deepEqual(cycleOf("Software Engineer Intern (Summer 2027)"), { years: [2027], seasons: ["summer"] });
  assert.deepEqual(cycleOf("Intern (Winter 2027/Summer 2027)").years, [2027]);
  assert.equal(cyclesConflict(cycleOf("Summer 2026"), cycleOf("Summer 2027")), true);
  assert.equal(cyclesConflict(cycleOf("Winter 2027/Summer 2027"), cycleOf("Summer 2027")), false);
  assert.equal(cyclesConflict(cycleOf("Summer 2027"), cycleOf("Fall 2027")), true);
  assert.equal(cyclesConflict(cycleOf("Intern"), cycleOf("Summer 2027")), false, "an unstated cycle is not a conflict");
  assert.deepEqual(programsOf("R&D Externship"), ["externship"]);
  assert.equal(isRoleFragment("and giving us the"), true);
  assert.equal(roleRelationV2("Software Engineer Intern - BS/MS", "Software Engineering Intern"), "match");
});

test("identity: a Gmail thread links compatible mail but never merges different cycles, roles or programs", () => {
  const g = groupEventsV2([
    ev({ id: "a", type: "applied", role: "Software Engineer Intern (Summer 2026)", day: 0, thread: "T" }),
    ev({ id: "b", type: "applied", role: "Software Engineer Intern (Summer 2027)", day: 250, thread: "T" }),
    ev({ id: "c", type: "applied", role: "Data Analyst Intern (Summer 2027)", day: 250, thread: "T" }),
    ev({ id: "d", type: "status_update", role: null, day: 255, thread: "T" }),
  ]);
  assert.equal(g.length, 3, "three applications in one thread");
  assert.ok(ids(g).some((x) => x.includes("d") && x.length === 2), "the neutral follow-up joins one of them");
});

test("identity: an externship is not an internship, even when the later mail says only 'Internship'", () => {
  const g = groupEventsV2([
    ev({ id: "a", type: "applied", role: "R&D Discovery Externship", day: 0 }),
    ev({ id: "b", type: "assessment", role: "Externship", day: 60 }),
    ev({ id: "c", type: "interview_invite", role: "Internship", day: 90 }),
  ]);
  assert.deepEqual(ids(g).sort(), [["a", "b"], ["c"]]);
});

test("identity: matching specific roles link across time only with positive cycle evidence; otherwise they must be recent", () => {
  const withCycle = groupEventsV2([ev({ id: "a", type: "applied", role: "Data Intern (Summer 2027)", day: 0 }), ev({ id: "b", type: "interview_invite", role: "Data Intern (Summer 2027)", day: 300 })]);
  assert.equal(withCycle.length, 1);
  const noCycle = groupEventsV2([ev({ id: "a", type: "applied", role: "Data Engineer Intern", day: 0 }), ev({ id: "b", type: "applied", role: "Data Engineer Intern", day: 300 })]);
  assert.equal(noCycle.length, 2);
});

test("identity: generic updates cannot chain an opportunity forever, and a rejection ends it", () => {
  const g = groupEventsV2([ev({ id: "a", type: "applied", role: "Software Engineer", day: 0 }), ev({ id: "b", type: "rejection", role: "Software Engineer", day: 10 }), ev({ id: "c", type: "applied", role: "Software Engineer", day: 20 }), ev({ id: "d", type: "status_update", role: null, day: 25 })]);
  assert.deepEqual(ids(g), [["a", "b"], ["c", "d"]]);
});

test("identity: a person's constraints are applied before any rule and survive regrouping (linkedTo / separate)", () => {
  const evs = (extra: Parameters<typeof ev>[0][]) => [ev({ id: "a", type: "applied", role: "Software Engineer Intern (Summer 2026)", day: 0 }), ev({ id: "b", type: "applied", role: "Software Engineer Intern (Summer 2027)", day: 250, ...(extra[0] ?? {}) })];
  assert.equal(groupEventsV2(evs([{ type: "applied", day: 250, linkedTo: "a" }])).length, 1, "forced together despite the cycle conflict");
  assert.equal(groupEventsV2([ev({ id: "a", type: "applied", role: "Software Engineer", day: 0 }), ev({ id: "b", type: "interview_invite", role: "Software Engineer", day: 5, separate: true })]).length, 2, "forced apart despite a perfect match");
  // a later event (re-read, late arrival) cannot undo them
  const more = [...evs([{ type: "applied", day: 250, linkedTo: "a" }]), ev({ id: "z", type: "status_update", role: null, day: 255 })];
  assert.equal(groupEventsV2(more).length, 1);
});

test("the title is the latest specific role, a person's role correction wins, and prose fragments are never a title", () => {
  const opps = buildOpportunities([ev({ type: "applied", role: "Software Engineer Intern (Summer 2027)", day: 0 }), ev({ type: "interview_invite", role: "Software Engineer, Intern (Winter 2027/Summer 2027)", day: 30 }), ev({ type: "status_update", role: "and giving us the", day: 31 })]);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].role, "Software Engineer, Intern (Winter 2027/Summer 2027)");
  const corrected = buildOpportunities([ev({ type: "applied", role: "Software Engineer Intern", day: 0 }), ev({ type: "interview_invite", role: "Platform Engineer Intern", day: 5, corrected: true })]);
  assert.equal(corrected[0].role, "Platform Engineer Intern");
});

test("keys: the same application keeps its key through more mail, re-reading in any order, and unrelated additions", () => {
  const core = [ev({ id: "a", type: "applied", role: "Software Engineer Intern (Summer 2027)", day: 0 }), ev({ id: "b", type: "assessment", role: "Software Engineer Intern (Summer 2027)", day: 10, date: 14 })];
  const key0 = buildOpportunities(core)[0].key;
  const later = buildOpportunities([...core, ev({ id: "c", type: "interview_invite", role: "Software Engineer, Intern (Winter 2027/Summer 2027)", day: 40 })]);
  assert.equal(later.length, 1);
  assert.equal(later[0].key, key0, "late-arriving mail does not rename the opportunity");
  assert.equal(buildOpportunities([...core].reverse())[0].key, key0, "input order does not matter");
  const other = buildOpportunities([...core, ev({ id: "x", type: "applied", role: "Data Analyst Intern (Summer 2027)", day: 12 }), ev({ id: "y", type: "applied", role: "Software Engineer Intern (Summer 2026)", day: 1 })]);
  assert.ok(other.some((o) => o.key === key0), "adding unrelated or older-cycle applications keeps it");
  assert.equal(new Set(other.map((o) => o.key)).size, other.length, "keys are unique");
});

test("keys and compatibility: overrides and dismissals made under the previous scheme still resolve, by event membership", () => {
  // under the previous scheme a Summer 2026 and Summer 2027 application of one role were one record with key 'acme~software-engineer'
  const evs = [ev({ id: "a", type: "applied", role: "Software Engineer Intern (Summer 2026)", day: 0 }), ev({ id: "b", type: "applied", role: "Software Engineer Intern (Summer 2027)", day: 250 }), ev({ id: "c", type: "interview_scheduled", role: "Software Engineer Intern (Summer 2027)", day: 260, date: 265 })];
  const opps = buildOpportunities(evs, new Map([["acme~software-engineer", { status: "closed" as const }]]));
  assert.equal(opps.length, 2);
  const current = opps.find((o) => o.events.some((e) => e.id === "c"))!, old = opps.find((o) => o.events.some((e) => e.id === "a"))!;
  assert.ok(current.legacyKeys?.includes("acme~software-engineer"), "the old key belongs to the opportunity holding its latest event");
  assert.equal(current.status, "closed", "the person's earlier 'closed' follows the current application");
  assert.equal(old.status !== "closed" || old.closedBy !== null, true);
  assert.ok(!old.legacyKeys?.includes("acme~software-engineer"), "the split-off earlier cycle does not inherit it");
  // dismissal ids written under the old key are honoured
  const actions = buildActions(buildOpportunities(evs), new Date(base + 262 * 86_400_000), new Set([`upcoming_interview:acme~software-engineer:c`]));
  assert.equal(actions.some((a) => a.kind === "upcoming_interview"), false);
});

test("reducer: stage is how far it got, status is whether it is open; expiry closes with its reason and later progress reopens", () => {
  const exp = reduceLifecycle([ev({ type: "assessment", day: 0, date: 5 }), ev({ type: "status_update", day: 6, signals: ["request expired"] })]);
  assert.deepEqual({ s: exp.stage, st: exp.status, by: exp.closedBy, o: exp.outcome }, { s: "assessment", st: "closed", by: "expired", o: "expired" });
  const re = reduceLifecycle([ev({ type: "assessment", day: 0 }), ev({ type: "status_update", day: 6, signals: ["request expired"] }), ev({ type: "assessment", day: 9 })]);
  assert.equal(re.status, "active");
  const past = reduceLifecycle([ev({ type: "interview_scheduled", day: 0, date: 3 }), ev({ type: "status_update", day: 9, signals: ["request expired"] })]);
  assert.equal(past.status, "active", "a lapse after the process moved past assessment is old news");
  const rej = reduceLifecycle([ev({ type: "applied", day: 0 }), ev({ type: "rejection", day: 5 }), ev({ type: "interview_invite", day: 9 })]);
  assert.equal(rej.status, "active", "a later stage event reopens a rejection");
});

test("reducer: doubtful readings never advance a stage while credible ones exist; a person's confirmation makes them count", () => {
  const doubtful = ev({ type: "interview_scheduled", day: 5, fc: 0.4 });
  assert.equal(reduceLifecycle([ev({ type: "applied", day: 0 }), doubtful]).stage, "applied");
  assert.equal(reduceLifecycle([ev({ type: "applied", day: 0 }), { ...doubtful, confirmed: true }]).stage, "interview");
  // nothing credible at all: a doubtful reading WITH a date is shown provisionally (and reviewed), not hidden
  assert.deepEqual(reduceLifecycle([{ ...doubtful, eventDate: new Date(base + 9 * 86_400_000), dateKind: "scheduled" }]).status, "active");
  // ...but an interview resting only on doubtful, UNDATED wording (typically a cancellation or a vague note) holds no place in the pipeline; review asks about it
  const undated = reduceLifecycle([doubtful]);
  assert.equal(undated.status, "closed");
  assert.equal(undated.closedBy, "not_recruiting");
  assert.equal(reduceLifecycle([{ ...doubtful, confirmed: true }]).status, "active", "a person's confirmation brings it back");
});

test("reducer: assessment results alone are not a candidacy; with any other evidence they are", () => {
  assert.equal(reduceLifecycle([ev({ type: "assessment_completed", day: 0 }), ev({ type: "assessment_completed", day: 0 })]).closedBy, "not_recruiting");
  assert.equal(reduceLifecycle([ev({ type: "assessment_completed", day: 0 }), ev({ type: "applied", day: 1 })]).status, "active");
  assert.equal(reduceLifecycle([ev({ type: "assessment_completed", day: 0, confirmed: true }), ev({ type: "assessment_completed", day: 0 })]).closedBy, "not_recruiting", "the rule is about the evidence type; a person reopens it with an override");
});

const NOW = new Date(base + 400 * 86_400_000);
const at = (daysAgo: number) => (NOW.getTime() - base) / 86_400_000 - daysAgo;
const acts = (events: EffectiveEvent[]) => buildActions(buildOpportunities(events), NOW);

test("dormancy: 60 days of silence is a low-priority 'worth a look' suggestion, never a status", () => {
  assert.equal(DORMANT_AFTER_DAYS, 60);
  const opp59 = acts([ev({ type: "applied", day: at(59), role: "Data Intern" })]);
  assert.ok(!opp59.some((a) => a.dormant));
  const opp = buildOpportunities([ev({ type: "applied", day: at(61), role: "Data Intern" })]);
  assert.equal(opp[0].status, "active", "silence closes nothing");
  const a = buildActions(opp, NOW);
  assert.deepEqual(a.map((x) => [x.kind, x.bucket, x.dormant]), [["check_in", "worth_a_look", true]]);
  const brief = buildBriefing(opp, a, NOW);
  assert.equal(brief.dormant.length, 1);
  assert.equal(brief.needsYou.length + brief.waiting.length, 0, "it never competes with, or inflates, 'waiting on replies'");
  assert.equal(acts([ev({ type: "applied", day: at(200), role: "Data Intern" })]).length, 0, "beyond 180 days it is history, not a nudge");
});

test("dormancy exceptions: a known interview, an open offer, an unexpired deadline, and any newer message are never dormant", () => {
  assert.ok(!acts([ev({ type: "applied", day: at(90), role: "A" }), ev({ type: "interview_scheduled", day: at(80), role: "A", date: at(-3) })]).some((a) => a.dormant));
  assert.ok(!acts([ev({ type: "offer", day: at(90), role: "A", date: at(-3) })]).some((a) => a.dormant));
  assert.ok(!acts([ev({ type: "offer", day: at(100), role: "A" })]).some((a) => a.dormant), "an open offer stays open until resolved");
  assert.ok(!acts([ev({ type: "assessment", day: at(70), role: "A", date: at(-5) })]).some((a) => a.dormant));
  assert.ok(!acts([ev({ type: "applied", day: at(100), role: "A" }), ev({ type: "user_reply", day: at(10), role: "A" })]).some((a) => a.dormant), "the person's own message resets the clock");
});

test("offers: an 'action needed' message after the dated offer, and replies to the recruiter, do not resolve it; withdrawal or rejection does", () => {
  const offer = [ev({ id: "o1", type: "offer", day: at(30), role: "A", thread: "T", date: at(24) }), ev({ type: "user_reply", day: at(29), thread: "T" }), ev({ id: "o2", type: "offer", day: at(3), role: "A", thread: "T" }), ev({ type: "user_reply", day: at(2), thread: "T" })];
  assert.equal(acts(offer).find((a) => a.kind === "offer_decision")?.kind, "offer_decision");
  assert.ok(!acts([...offer, ev({ type: "withdrawn", day: at(1), role: "A" })]).some((a) => a.kind === "offer_decision"));
  // a month on with nothing newer, the offer stays in the pipeline (an offer is never dormant) but stops being a task for today
  assert.ok(!acts([ev({ type: "offer", day: at(60), role: "A" })]).some((a) => a.kind === "offer_decision" || a.dormant));
});

test("corrections: link constraints are validated, serialized and carried onto the event", () => {
  const parsed = parseCorrection({ linkedTo: "abc123", separate: true, junk: 1 });
  assert.deepEqual(parsed, { linkedTo: "abc123", separate: true });
  assert.deepEqual(serializeCorrection(parsed!), { linkedTo: "abc123", separate: true });
  const eff = applyCorrection({ ...ev({ id: "q", type: "applied", day: 0 }) }, parsed);
  assert.equal(eff?.linkedTo, "abc123");
  assert.equal(eff?.separate, true);
  assert.equal(parseCorrection({ linkedTo: 5, separate: "yes" }), undefined);
});

test("display repair: mojibake left by a mislabeled charset is repaired, clean text is untouched", () => {
  assert.equal(repairText("Full Stack Software Engineer Intern - Summer 2027Â"), "Full Stack Software Engineer Intern - Summer 2027");
  assert.equal(repairText("Don’t miss it"), "Don’t miss it");
  assert.equal(repairText("Donâ€™t miss it"), "Don’t miss it");
  assert.equal(repairText("Software Engineer"), "Software Engineer");
  assert.equal(repairText(null), null);
});

// ---------------------------------------------------------------- Opportunity Intelligence v3: abstention and evidence weighing (fictional employers; original wording of the failure patterns)
test("identity v3: a role-less rejection at an employer with two live applications for different roles is not guessed; with one live application it joins", () => {
  const two = [
    ev({ id: "a1", type: "applied", role: "Editorial Intern", day: 0, thread: "ta" }),
    ev({ id: "a2", type: "applied", role: "Audience Analytics Intern", day: 1, thread: "tb" }),
    ev({ id: "r", type: "rejection", role: null, day: 20, thread: "tc" }),
  ];
  const g = groupEventsV2(two);
  assert.equal(g.length, 3, "the rejection stays apart rather than closing the wrong application");
  const opps = buildOpportunities(two);
  assert.ok(opps.some((o) => o.contradictions?.some((c) => c.kind === "ambiguous_identity")), "and says why");
  const one = groupEventsV2([ev({ id: "a1", type: "applied", role: "Editorial Intern", day: 0, thread: "ta" }), ev({ id: "r", type: "rejection", role: null, day: 20, thread: "tc" })]);
  assert.equal(one.length, 1, "no false abstention when only one application is live");
});

test("identity v3: a receipt or reminder with no role rides with the latest application and is marked; it never creates a duplicate card", () => {
  const g = groupEventsV2([
    ev({ id: "a1", type: "applied", role: "Editorial Intern", day: 0, thread: "ta" }),
    ev({ id: "a2", type: "applied", role: "Audience Analytics Intern", day: 1, thread: "tb" }),
    ev({ id: "n", type: "follow_up", role: null, day: 10, thread: "tc" }),
  ]);
  assert.equal(g.length, 2);
  assert.ok(g.some((x) => x.events.some((e) => e.id === "n" && e.signals.includes("identity:ambiguous"))));
});

test("identity v3: a role copied from an earlier message of the thread is not evidence about the later message", () => {
  const g = groupEventsV2([
    ev({ id: "a1", type: "applied", role: "Editorial Intern", day: 0, thread: "T" }),
    ev({ id: "a2", type: "applied", role: "Audience Analytics Intern", day: 1, thread: "T" }),
    ev({ id: "x", type: "interview_invite", role: "Editorial Intern", day: 9, thread: "T", signals: ["role-inherited"] }),
  ]);
  assert.equal(g.length, 3, "an inherited role does not pull the invitation into the first application");
  const real = groupEventsV2([
    ev({ id: "a1", type: "applied", role: "Editorial Intern", day: 0, thread: "T" }),
    ev({ id: "a2", type: "applied", role: "Audience Analytics Intern", day: 1, thread: "T" }),
    ev({ id: "x", type: "interview_invite", role: "Editorial Intern", day: 9, thread: "T" }),
  ]);
  assert.equal(real.length, 2, "the same role stated by the message itself does join it");
});

test("identity v3: a reply or continuity event that borrowed its anchor's role does not pull itself into that application; a message stating the same role does", () => {
  for (const marker of ["reply-in-recruiting-thread", "known-contact-continuity"]) {
    const g = groupEventsV2([
      ev({ id: "a1", type: "applied", role: "Quality Control Intern", day: 0, thread: "T" }),
      ev({ id: "a2", type: "applied", role: "Regulatory Affairs Intern", day: 1, thread: "T" }),
      ev({ id: "x", type: "rejection", role: "Quality Control Intern", day: 9, thread: "T", signals: [marker] }),
    ]);
    assert.equal(g.length, 3, `${marker}: a borrowed role is not evidence`);
  }
});

test("identity audit: a role-less message is attached by its own subject words or by its sender's earlier mail, only when exactly one candidate stands out", () => {
  const withSubject = (id: string, subject: string, extra: Partial<Parameters<typeof ev>[0]> = {}) => ({ ...ev({ id, type: "interview_scheduled", role: null, day: 20, thread: `t-${id}`, ...extra }), subject });
  const apps = [
    ev({ id: "a1", type: "applied", role: "2026 R&D Innovate Boldly Externship", day: 0, thread: "ta" }),
    ev({ id: "a2", type: "applied", role: "Summer 2026 Intern", day: 1, thread: "tb" }),
  ];
  // the subject names the externship's own words
  const g1 = groupEventsV2([...apps, withSubject("x", "Acme - 2026 R&D Externship Interview")]);
  assert.ok(g1.some((g) => g.events.some((e) => e.id === "a1") && g.events.some((e) => e.id === "x")), "joined the externship");
  // a subject that shares only one word, or words with both candidates, is not enough
  const g2 = groupEventsV2([...apps, withSubject("y", "Interview with Acme")]);
  assert.equal(g2.length, 3, "nothing to go on: kept apart");
  // the same sender wrote a message of exactly one candidate recently
  const sender = (id: string, day: number) => ({ ...ev({ id, type: "interview_invite", role: null, day, thread: `t-${id}` }), senderName: "University Relations Team", senderDomain: "recruit.example" });
  const base = [{ ...ev({ id: "b1", type: "applied", role: "2026 R&D Innovate Boldly Externship", day: 0, thread: "ta" }) }, { ...ev({ id: "b2", type: "applied", role: "Summer 2026 Intern", day: 1, thread: "tb" }) }, { ...sender("s1", 10), role: "2026 R&D Innovate Boldly Externship" }];
  const g3 = groupEventsV2([...base, sender("s2", 12)]);
  assert.ok(g3.some((g) => g.events.some((e) => e.id === "s1") && g.events.some((e) => e.id === "s2")), "the reminder follows its invitation");
});
