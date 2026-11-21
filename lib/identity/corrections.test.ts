import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActions } from "../recruiting/actions.ts";
import { buildOpportunities } from "../recruiting/opportunity.ts";
import type { EffectiveEvent, EventType } from "../recruiting/types.ts";
import { groupEventsV2, type IdentityContext } from "../lifecycle/identity.ts";
import { rolePairKey, type RoleVerdicts } from "./role-equivalence.ts";

/**
 * CORRECTION PRESERVATION, measured on its own (never folded into an accuracy number): whatever a regrouping, a reader change or an identity option does, a person's explicit
 * decisions hold. Property tests over seeded random event sets, in the current identity and in every Phase 2 option.
 */
const ROLES = ["Data Analyst Intern", "Analyst Intern (Data)", "Operations Research Intern", "Summer 2026 Analyst Internship", "Summer 2027 Analyst Internship", "Software Engineer Intern", "SWE Intern", null, null];
const TYPES: EventType[] = ["applied", "assessment", "interview_invite", "interview_scheduled", "offer", "rejection", "withdrawn", "status_update", "recruiter_outreach"];
const COMPANIES = ["Harborline", "Fernbank", "Quartzline", null];
function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

function makeEvents(seed: number): EffectiveEvent[] {
  const r = rng(seed); const n = 8 + Math.floor(r() * 10); const out: EffectiveEvent[] = [];
  for (let i = 0; i < n; i++) {
    const role = pick(r, ROLES);
    out.push({
      id: `e${i}`, gmailMessageId: `e${i}`, gmailThreadId: `t${Math.floor(r() * 5)}`, occurredAt: new Date(Date.UTC(2026, 8, 1) + i * 3 * 86_400_000 + Math.floor(r() * 3) * 3_600_000), outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Update",
      type: pick(r, TYPES), company: pick(r, COMPANIES), role, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.8, fieldConfidence: { type: 0.8, company: 0.8, role: role ? 0.7 : 0 }, reviewReasons: [], signals: r() < 0.15 ? ["role-inherited"] : [], corrected: false,
    });
  }
  // a person's decisions on some of them
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.2) Object.assign(out[i], { corrected: true, role: pick(r, ROLES.filter(Boolean)), type: pick(r, TYPES), company: pick(r, COMPANIES.filter(Boolean)) });
    else if (x < 0.3) out[i].confirmed = true;
    else if (x < 0.4 && i > 0) out[i].linkedTo = `e${Math.floor(r() * i)}`;
    else if (x < 0.5) out[i].separate = true;
  }
  return out;
}
const verdictsFor = (events: EffectiveEvent[], seed: number): RoleVerdicts => {
  const r = rng(seed ^ 0x9e3779b9); const m: RoleVerdicts = new Map();
  const roles = [...new Set(events.map((e) => e.role).filter((x): x is string => !!x))];
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) m.set(rolePairKey(roles[i], roles[j]), r() < 0.5 ? "same" : "different");
  return m;
};
const contexts = (events: EffectiveEvent[], seed: number): Record<string, IdentityContext | undefined> => ({
  current: undefined,
  phase2: { roleVerdicts: verdictsFor(events, seed), weakEmployerThreads: true, distinctThreadReceipts: true },
});

test("a person's decisions hold in every identity option, over 300 random event sets", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const events = makeEvents(seed);
    for (const [name, ctx] of Object.entries(contexts(events, seed))) {
      const groups = groupEventsV2(events, ctx);
      const where = new Map<string, number>(); groups.forEach((g, gi) => g.events.forEach((e) => where.set(e.id, gi)));
      assert.equal(where.size, events.length, `${name}/${seed}: every event is in exactly one application`);
      const out = new Map(groups.flatMap((g) => g.events.map((e) => [e.id, e] as const)));
      for (const e of events) {
        const o = out.get(e.id)!;
        if (e.corrected || e.confirmed) assert.deepEqual([o.type, o.company, o.role], [e.type, e.company, e.role], `${name}/${seed}: ${e.id} keeps what the person vouched for`);
        if (e.linkedTo && out.has(e.linkedTo)) assert.equal(where.get(e.id), where.get(e.linkedTo), `${name}/${seed}: ${e.id} stays with the message the person linked it to`);
        if (e.separate && !e.linkedTo) assert.equal(groups[where.get(e.id)!].events[0].id, e.id, `${name}/${seed}: ${e.id} never joins an earlier application`);
      }
    }
  }
});

test("regrouping is order-independent: the same events in any order give the same applications", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const events = makeEvents(seed); const r = rng(seed + 77);
    for (const [name, ctx] of Object.entries(contexts(events, seed))) {
      const partition = (evs: EffectiveEvent[]) => groupEventsV2(evs, ctx).map((g) => g.events.map((e) => e.id).sort().join("+")).sort().join("|");
      const shuffled = [...events].sort(() => r() - 0.5);
      assert.equal(partition(shuffled), partition(events), `${name}/${seed}`);
    }
  }
});

test("DORMANCY: silence never closes or rejects an application; it is only a quiet suggestion", () => {
  const base = { gmailThreadId: "t1", outbound: false, senderName: "Careers", senderDomain: "careers.example", subject: "Application received", company: "Pelham", role: "Technical Artist Intern", eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.9 }, reviewReasons: [], signals: [], corrected: false } as const;
  const last = new Date("2026-02-01T12:00:00Z");
  for (const quietDays of [10, 61, 120, 179, 181, 400]) {
    const events: EffectiveEvent[] = [
      { ...base, id: "a", gmailMessageId: "a", type: "applied", occurredAt: new Date(last.getTime() - 20 * 86_400_000) },
      { ...base, id: "b", gmailMessageId: "b", type: "assessment_completed", occurredAt: last },
    ];
    const opps = buildOpportunities(events);
    const now = new Date(last.getTime() + quietDays * 86_400_000);
    assert.equal(opps[0].status, "active", `${quietDays} quiet days`);
    assert.equal(opps[0].outcome, null);
    const actions = buildActions(opps, now);
    assert.equal(buildOpportunities(events)[0].status, "active", "building actions does not change the application");
    for (const a of actions) assert.ok(!/reject|clos/i.test(a.kind), `no closing action (${a.kind})`);
    if (quietDays >= 61 && quietDays <= 180) assert.ok(actions.some((a) => a.dormant === true), `a quiet application at ${quietDays} days is a low-priority suggestion`);
    if (quietDays > 180) assert.equal(actions.filter((a) => a.opportunityKey === opps[0].key).length, 0, "after 180 quiet days it is left alone, still active");
  }
});
