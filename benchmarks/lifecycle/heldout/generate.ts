import type { Facet, LifecycleCase } from "../dev/cases.ts";
import type { EvSpec } from "../harness.ts";

/**
 * SEALED synthetic HELD-OUT set. Generated from a recorded seed with scenario families that differ from the development cases (different employers, roles,
 * dates, thread layouts) and truth FIXED BY CONSTRUCTION: each scenario knows exactly which messages belong to which opportunity and what state it is in.
 * Rules of use (see ../README.md): never consult individual held-out results while implementing; run it only at milestone gates (`npm run bench:lifecycle -- --heldout`);
 * never tune a rule, threshold or pattern to it. No BLIND labels or datasets are read here or anywhere in this benchmark. A REAL held-out set (>= 100 opportunities
 * from the person's own mailbox, labelled by the person) is a separate artifact that lives outside the repository.
 */
export const HELDOUT_SEED = 20261118;
export const HELDOUT_SIZE = 54;

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const EMPLOYERS = ["Alderwood Robotics", "Bluefin Health", "Cinder Analytics", "Dovetail Cloud", "Eastgate Bio", "Fathom Security", "Glasshouse Labs", "Harbor Quantum", "Ironbridge Data", "Juniper Mobility", "Keystone Energy", "Lumen Foundry", "Marigold Pay", "Northwind Games", "Orchard Systems", "Pinecrest AI", "Quarry Devices", "Redwood Semiconductor"];
const ROLES = ["Software Engineer Intern", "Data Analyst Intern", "Machine Learning Intern", "Product Design Intern", "Security Engineer Intern", "Hardware Engineer Intern"];
const SEASONS = ["Summer", "Fall", "Winter", "Spring"];
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Gen = (id: string, company: string, rnd: () => number) => LifecycleCase;
const pick = <T,>(xs: T[], rnd: () => number) => xs[Math.floor(rnd() * xs.length)];

const families: Gen[] = [
  // reapply for the same role the next season or year
  (id, company, rnd) => {
    const role = pick(ROLES, rnd), s1 = pick(SEASONS, rnd), y = 2025 + Math.floor(rnd() * 2);
    const t0 = `2026-0${1 + Math.floor(rnd() * 3)}-1${Math.floor(rnd() * 9)}`;
    const t1 = addDays(t0, 200 + Math.floor(rnd() * 60));
    const events: EvSpec[] = [
      { id: `${id}-a1`, at: t0, type: "applied", role: `${role} (${s1} ${y})` }, { id: `${id}-a2`, at: addDays(t0, 9), type: "assessment", role: `${role} (${s1} ${y})`, date: addDays(t0, 14) },
      { id: `${id}-b1`, at: t1, type: "applied", role: `${role} (${s1} ${y + 1})` }, { id: `${id}-b2`, at: addDays(t1, 20), type: "interview_scheduled", role: `${role} (${s1} ${y + 1})`, date: `${addDays(t1, 27)}T15:00:00Z` },
    ];
    return { id: `${id}-reapply`, findings: ["F-01"], title: "reapplied the next cycle", company, now: addDays(t1, 24), events, truth: [[`${id}-a1`, `${id}-a2`], [`${id}-b1`, `${id}-b2`]], facets: [
      { cat: "grouping", kind: "cannotLink", a: `${id}-a1`, b: `${id}-b1`, why: "next cycle is a new opportunity" } as Facet,
      { cat: "grouping", kind: "mustLink", a: `${id}-b1`, b: `${id}-b2`, why: "one lifecycle" } as Facet,
      { cat: "role", kind: "role", of: `${id}-b2`, includes: String(y + 1), excludes: String(y), why: "title from the latest cycle" } as Facet,
    ] };
  },
  // two different roles applied the same day, receipts in one Gmail thread
  (id, company, rnd) => {
    const [r1, r2] = [ROLES[Math.floor(rnd() * 3)], ROLES[3 + Math.floor(rnd() * 3)]];
    const t = `2026-09-${10 + Math.floor(rnd() * 10)}`;
    return { id: `${id}-tworoles`, findings: ["F-05"], title: "two roles, one thread", company, now: addDays(t, 30), truth: [[`${id}-1`], [`${id}-2`]], events: [
      { id: `${id}-1`, at: `${t}T10:00:00Z`, type: "applied", role: `${r1} - Summer 2027`, thread: `${id}-T` }, { id: `${id}-2`, at: `${t}T10:00:40Z`, type: "applied", role: `${r2} - Summer 2027`, thread: `${id}-T` },
    ], facets: [{ cat: "grouping", kind: "cannotLink", a: `${id}-1`, b: `${id}-2`, why: "different roles are different applications" }] };
  },
  // assessment that expires
  (id, company, rnd) => {
    const t = addDays("2026-08-01", Math.floor(rnd() * 40));
    return { id: `${id}-expired`, findings: ["F-03"], title: "assessment expired", company, now: addDays(t, 60), truth: [[`${id}-1`, `${id}-2`]], events: [
      { id: `${id}-1`, at: t, type: "assessment", date: addDays(t, 7), signals: ["assessment", "subject"] },
      { id: `${id}-2`, at: addDays(t, 8), type: "status_update", signals: ["request expired", "subject"] },
    ], facets: [{ cat: "terminal", kind: "active", of: `${id}-2`, is: false, why: "expired" }, { cat: "review", kind: "contradictionFlagged", of: `${id}-2`, why: "contradiction must be visible" }] };
  },
  // a clean lifecycle to an offer with a later dated action
  (id, company, rnd) => {
    const role = pick(ROLES, rnd), t = addDays("2026-05-01", Math.floor(rnd() * 30));
    return { id: `${id}-offer`, findings: ["F-02"], title: "offer with an action", company, now: addDays(t, 52), truth: [[1, 2, 3, 4, 5, 6].map((n) => `${id}-${n}`)], events: [
      { id: `${id}-1`, at: t, type: "applied", role: `${role} - Summer 2027` }, { id: `${id}-2`, at: addDays(t, 14), type: "assessment", role: `${role} - Summer 2027`, date: addDays(t, 18) },
      { id: `${id}-3`, at: addDays(t, 30), type: "interview_scheduled", role: `${role} - Summer 2027`, date: `${addDays(t, 33)}T16:00:00Z` }, { id: `${id}-4`, at: addDays(t, 48), type: "offer", role: `${role} - Summer 2027`, thread: `${id}-T`, signals: ["offer", "subject"] },
      { id: `${id}-5`, at: addDays(t, 49), type: "user_reply", thread: `${id}-T` }, { id: `${id}-6`, at: addDays(t, 50), type: "offer", role: `${role} - Summer 2027`, thread: `${id}-T`, signals: ["offer", "subject", "role-inherited"] },
    ], facets: [
      { cat: "grouping", kind: "mustLink", a: `${id}-1`, b: `${id}-6`, why: "one lifecycle" }, { cat: "regression", kind: "stage", of: `${id}-6`, is: "offer", why: "offer stage" },
      { cat: "actions", kind: "action", of: `${id}-6`, actionKind: "offer_decision", present: true, why: "an explicit offer message two days old needs a decision" },
    ] };
  },
  // rejection, then a re-application a year later
  (id, company, rnd) => {
    const role = pick(ROLES, rnd), t = addDays("2025-10-01", Math.floor(rnd() * 30));
    return { id: `${id}-reject-reapply`, findings: ["F-01"], title: "rejected, applied again next year", company, now: addDays(t, 400), truth: [[`${id}-1`, `${id}-2`], [`${id}-3`]], events: [
      { id: `${id}-1`, at: t, type: "applied", role: `${role} (Summer 2026)` }, { id: `${id}-2`, at: addDays(t, 40), type: "rejection", role: `${role} (Summer 2026)` },
      { id: `${id}-3`, at: addDays(t, 365), type: "applied", role: `${role} (Summer 2027)` },
    ], facets: [{ cat: "grouping", kind: "cannotLink", a: `${id}-2`, b: `${id}-3`, why: "a new application after rejection is new" }, { cat: "regression", kind: "active", of: `${id}-3`, is: true, why: "the new application is active" }, { cat: "regression", kind: "active", of: `${id}-2`, is: false, why: "the old one is closed" }] };
  },
  // a long, ordinary single lifecycle with generic follow-ups
  (id, company, rnd) => {
    const role = pick(ROLES, rnd), t = addDays("2026-08-01", Math.floor(rnd() * 30));
    return { id: `${id}-plain`, findings: [], title: "plain lifecycle", company, now: addDays(t, 20), truth: [[`${id}-1`, `${id}-2`, `${id}-3`]], events: [
      { id: `${id}-1`, at: t, type: "applied", role: `${role} - Summer 2027` }, { id: `${id}-2`, at: addDays(t, 6), type: "status_update", role: `${role} - Summer 2027` }, { id: `${id}-3`, at: addDays(t, 12), type: "recruiter_outreach", role: `${role} - Summer 2027` },
    ], facets: [{ cat: "regression", kind: "mustLink", a: `${id}-1`, b: `${id}-3`, why: "one lifecycle" }, { cat: "regression", kind: "active", of: `${id}-3`, is: true, why: "active" }] };
  },
  // interview the employer cancelled (low-confidence 'scheduled' with no time)
  (id, company, rnd) => {
    const t = addDays("2026-01-10", Math.floor(rnd() * 60));
    return { id: `${id}-cancel`, findings: ["F-06"], title: "cancelled interview", company, now: addDays(t, 120), truth: [[`${id}-1`]], events: [
      { id: `${id}-1`, at: t, type: "interview_scheduled", role: pick(ROLES, rnd), fc: { type: 0.4, role: 0.6, company: 0.85 }, reviewReasons: ["type: interview wording without a specific time"] },
    ], facets: [{ cat: "terminal", kind: "active", of: `${id}-1`, is: false, why: "a low-confidence, undated interview wording cannot hold an opportunity open for months" }] };
  },
  // assessment results with no candidacy
  (id, company, rnd) => {
    const t = addDays("2026-03-01", Math.floor(rnd() * 80));
    return { id: `${id}-results-only`, findings: ["F-08"], title: "assessment results only", company, now: addDays(t, 100), truth: [[`${id}-1`]], events: [
      { id: `${id}-1`, at: t, type: "assessment_completed", signals: ["assessment received", "subject"], fc: { type: 0.9, company: 0.6, role: 0.5 } },
    ], facets: [{ cat: "false-positive", kind: "active", of: `${id}-1`, is: false, why: "no candidacy evidence" }] };
  },
];

export function generateHeldout(seed = HELDOUT_SEED, size = HELDOUT_SIZE): LifecycleCase[] {
  const rnd = rng(seed);
  return Array.from({ length: size }, (_, i) => {
    const company = `${EMPLOYERS[i % EMPLOYERS.length]}${i >= EMPLOYERS.length ? ` ${Math.floor(i / EMPLOYERS.length) + 1}` : ""}`;
    return families[i % families.length](`h${String(i).padStart(2, "0")}`, company, rnd);
  });
}
