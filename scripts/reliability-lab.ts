/**
 * Reliability lab: where do recruiting messages get lost, and how often is what IS shown confidently wrong?
 * Development data only; aggregates only. Usage: node --import ./scripts/loader/register.mjs scripts/reliability-lab.ts <labels.json>
 */
import { extractAll, extractWithReason } from "../lib/recruiting/extract.ts";
import { toReaderType } from "../lib/recruiting/reader/taxonomy.ts";
import { decide } from "../lib/recruiting/policy.ts";
import { loadDev, pct, category, DEV, type Msg } from "./lab-data.ts";
import type { ExtractedEvent } from "../lib/recruiting/types.ts";

const { messages } = loadDev(process.argv[2]);
const positives = messages.filter((m) => m.positive);
console.log(`dev messages ${messages.length}, recruiting ${positives.length}`);

// Reading through the sweep gate in one batch per dataset (the best case for continuity).
const events = new Map<string, ExtractedEvent>();
for (const ds of DEV) for (const e of extractAll(messages.filter((m) => m.ds === ds && category(m)))) events.set(`${ds}|${e.gmailMessageId}`, e);
const ev = (m: Msg) => events.get(`${m.ds}|${m.id}`);

// 1. Where is each recruiting message lost?
const lost = new Map<string, number>();
for (const m of positives) {
  const e = ev(m);
  const where = !category(m) ? "retrieval (category)" : e ? "found" : `reader rejected: ${extractWithReason(m).reason ?? "accepted alone"}`;
  lost.set(where, (lost.get(where) ?? 0) + 1);
}
console.log("\nWHERE RECRUITING MESSAGES ARE LOST (sweep):", [...lost].map(([k, v]) => `${k}=${v}`).join("; "));

// 2. Type correctness among found, and whether a wrong type is flagged (state != accepted) or shown as fact
let found = 0, typeOk = 0, typeOkCollapsed = 0, wrong = 0, wrongShown = 0, unlabeled = 0;
const confusion = new Map<string, number>();
for (const m of positives) {
  const e = ev(m);
  if (!e) continue;
  found += 1;
  if (!m.type || m.type === "unknown" || m.type === "not_applicable") { unlabeled += 1; continue; }
  const label = m.type === "applied" && m.stage === "assessment" ? "assessment" : m.type;
  const exact = e.type === label;
  const collapsed = toReaderType(e.type) === toReaderType(label as never);
  if (exact) typeOk += 1;
  if (collapsed) typeOkCollapsed += 1;
  if (!collapsed) {
    wrong += 1;
    const shown = decide(e.type, e.fieldConfidence?.type ?? e.confidence, undefined, "type").state === "accepted";
    if (shown) wrongShown += 1;
    const k = `${toReaderType(label as never)}->${toReaderType(e.type)}${shown ? " (shown as fact)" : " (flagged)"}`;
    confusion.set(k, (confusion.get(k) ?? 0) + 1);
  }
}
console.log(`\nTYPE on found messages (n=${found - unlabeled} labelled): exact ${typeOk} (${pct(typeOk, found - unlabeled)}), collapsed-taxonomy ${typeOkCollapsed} (${pct(typeOkCollapsed, found - unlabeled)}); wrong ${wrong}, of which SHOWN AS FACT ${wrongShown}`);
console.log("  confusion:", [...confusion].map(([k, v]) => `${k}=${v}`).join("; ") || "none");

// 3. False positives: what do they look like (aggregate only)?
const fps = [...events.entries()].filter(([k]) => { const [ds, id] = k.split("|"); const m = messages.find((x) => x.ds === ds && x.id === id); return m && !m.positive; });
const fpType = new Map<string, number>();
let fpShown = 0;
for (const [, e] of fps) {
  fpType.set(e.type, (fpType.get(e.type) ?? 0) + 1);
  const needs = !e.company || decide(e.type, e.fieldConfidence?.type ?? 1, undefined, "type").state !== "accepted" || (e.company ? decide(e.company, e.fieldConfidence?.company ?? 1, undefined, "company").state !== "accepted" : false);
  if (!needs) fpShown += 1;
}
console.log(`\nFALSE POSITIVES ${fps.length}: by type ${[...fpType].map(([k, v]) => `${k}=${v}`).join(", ")}; shown as fact (no review flag) ${fpShown}`);

// 4. Type-confidence distribution by type, true vs false positives: would a consequence-weighted review line be cheap?
console.log("\nTYPE CONFIDENCE (fieldConfidence.type) by type: n true / n false, share at least 0.55 / 0.7 / 0.85");
const byType = new Map<string, { t: number[]; f: number[] }>();
for (const [k, e] of events) {
  const [ds, id] = k.split("|"); const m = messages.find((x) => x.ds === ds && x.id === id)!;
  const b = byType.get(e.type) ?? { t: [], f: [] }; (m.positive ? b.t : b.f).push(e.fieldConfidence?.type ?? e.confidence); byType.set(e.type, b);
}
for (const [t, b] of [...byType].sort()) {
  const share = (xs: number[], c: number) => (xs.length ? `${xs.filter((x) => x >= c).length}/${xs.length}` : "-");
  console.log(`${t.padEnd(22)} true ${String(b.t.length).padStart(2)} (>=.55 ${share(b.t, 0.55)}, >=.7 ${share(b.t, 0.7)}, >=.85 ${share(b.t, 0.85)})   false ${String(b.f.length).padStart(2)} (>=.55 ${share(b.f, 0.55)}, >=.7 ${share(b.f, 0.7)}, >=.85 ${share(b.f, 0.85)})`);
}

// 5. Structural features of ACCEPTED events, true vs false positives (is it bulk? is it addressed to a person? is a candidacy named?)
import { classifySender } from "../lib/recruiting/entity/vendors.ts";
import { processEvidence } from "../lib/recruiting/signals.ts";
import { parseSender } from "../lib/opportunities/normalize.ts";
const BULK = /\b(?:unsubscribe|manage (?:your )?(?:email )?preferences|view (?:this )?(?:email )?in (?:your )?browser|email preferences|opt[- ]out|you are receiving this|sent to you because)\b/i;
const GREETING = /^\s*(?:hi|hello|hey|dear)\s+[A-Z][a-z]+\b/;
const feats: Array<[string, (m: Msg) => boolean]> = [
  ["bulk-mail footer (unsubscribe/preferences/view in browser)", (m) => BULK.test(m.bodyText)],
  ["greets a named person (Hi/Dear Name)", (m) => GREETING.test(m.bodyText)],
  ["sender is applicant-tracking/assessment platform", (m) => ["ats", "assessment"].includes(classifySender(parseSender(m.from).domain))],
  ["sender is employer-like domain", (m) => classifySender(parseSender(m.from).domain) === "employer"],
  ["names a candidacy (your application for…, interview with…, recruiter…)", (m) => processEvidence(m.subject, m.bodyText).candidacy],
  ["employment object present (job/role/internship/…)", (m) => processEvidence(m.subject, m.bodyText).employment],
  ["Gmail IMPORTANT label", (m) => m.labels.includes("IMPORTANT")],
  ["Gmail CATEGORY_PERSONAL", (m) => m.labels.includes("CATEGORY_PERSONAL")],
];
const accepted = [...events.keys()].map((k) => { const [ds, id] = k.split("|"); return messages.find((x) => x.ds === ds && x.id === id)!; });
const T = accepted.filter((m) => m.positive), F = accepted.filter((m) => !m.positive);
console.log(`\nSTRUCTURAL FEATURES of accepted events (true ${T.length} / false ${F.length})`);
for (const [name, f] of feats) console.log(`${name.padEnd(72)} true ${String(T.filter(f).length).padStart(2)}/${T.length}  false ${String(F.filter(f).length).padStart(2)}/${F.length}`);

// 6. Combinations (independent evidence agreeing that membership is doubtful). Burden = true events that would be flagged.
const anchor = (m: Msg) => processEvidence(m.subject, m.bodyText).candidacy;
const important = (m: Msg) => m.labels.includes("IMPORTANT");
const bulk = (m: Msg) => BULK.test(m.bodyText);
const ats = (m: Msg) => ["ats", "assessment"].includes(classifySender(parseSender(m.from).domain));
const combos: Array<[string, (m: Msg) => boolean]> = [
  ["no candidacy anchor AND not IMPORTANT", (m) => !anchor(m) && !important(m)],
  ["no candidacy anchor AND not IMPORTANT AND not ATS sender", (m) => !anchor(m) && !important(m) && !ats(m)],
  ["no candidacy anchor AND not ATS sender", (m) => !anchor(m) && !ats(m)],
  ["bulk footer AND no candidacy anchor", (m) => bulk(m) && !anchor(m)],
  ["bulk footer OR (no anchor AND not IMPORTANT)", (m) => bulk(m) || (!anchor(m) && !important(m))],
  ["not IMPORTANT AND not ATS sender", (m) => !important(m) && !ats(m)],
];
console.log("\nCOMBINATIONS (flagged true / flagged false):");
for (const [name, f] of combos) console.log(`${name.padEnd(62)} true ${String(T.filter(f).length).padStart(2)}/${T.length}  false ${String(F.filter(f).length).padStart(2)}/${F.length}`);

// 7. Near-miss tier built from INDEPENDENT evidence (not hiring vocabulary): rejected messages that still tie to a candidacy,
//    are Gmail-important, are not bulk, and have an employment object. Burden vs recovery.
const rejected = messages.filter((m) => category(m) && !events.has(`${m.ds}|${m.id}`));
const reasonOf = (m: Msg) => extractWithReason(m).reason ?? "accepted-alone";
const nm: Array<[string, (m: Msg) => boolean]> = [
  ["candidacy anchor", (m) => anchor(m)],
  ["candidacy anchor AND IMPORTANT", (m) => anchor(m) && important(m)],
  ["candidacy anchor AND IMPORTANT AND not bulk", (m) => anchor(m) && important(m) && !bulk(m)],
  ["candidacy anchor AND IMPORTANT AND not bulk AND reason in {no_language,no_context}", (m) => anchor(m) && important(m) && !bulk(m) && ["no_recruiting_language", "no_recruiting_context"].includes(reasonOf(m))],
  ["candidacy anchor AND not bulk AND reason in {no_language,no_context}", (m) => anchor(m) && !bulk(m) && ["no_recruiting_language", "no_recruiting_context"].includes(reasonOf(m))],
];
console.log(`\nNEAR-MISS TIERS over ${rejected.length} rejected messages in the sweep (${rejected.filter((m) => m.positive).length} are recruiting)`);
for (const [name, f] of nm) { const fl = rejected.filter(f); const hit = fl.filter((m) => m.positive).length; console.log(`${name.padEnd(100)} flagged ${String(fl.length).padStart(3)} (${((1000 * fl.length) / messages.length).toFixed(0)}/1000) recovered ${hit} noise ${fl.length - hit}`); }

// 8. Chunk invariance through the REAL engine with stored contact context: the set of events must not depend on how the sync was cut.
import { runSync, type MailSource, type SyncStore } from "../lib/recruiting/sync-engine.ts";
import { mergeTiers } from "../lib/discovery/strategy.ts";
import { matchesLegacyQuery } from "../lib/discovery/legacy-query.ts";
import { buildPredictions, type Prediction } from "../lib/recruiting/predictions.ts";
import { inheritRoles, isContinuityCandidate, outboundEvent, type ThreadAnchor } from "../lib/recruiting/extract.ts";

async function engineEvents(chunk: number, withContext: boolean) {
  const out = new Map<string, ExtractedEvent>();
  let predMismatch = 0;
  for (const ds of DEV) {
    const mail = messages.filter((m) => m.ds === ds);
    const newest = (xs: Msg[]) => [...xs].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((e) => ({ id: e.id, threadId: e.threadId }));
    const source: MailSource = {
      async listCandidates() { return mergeTiers(newest(mail.filter((m) => matchesLegacyQuery(m.from, m.subject))), newest(mail.filter(category))); },
      async fetchEmails(ids) { return { emails: mail.filter((e) => ids.includes(e.id)), missing: [] }; },
      async fetchOutbound() { return []; },
    };
    const events = new Map<string, ExtractedEvent>(), preds = new Map<string, Prediction>();
    const store: SyncStore = {
      async evaluatedIds(ids) { return new Set(ids.filter((i) => preds.has(i))); },
      async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
      async savePredictions(ps) { for (const p of ps) preds.set(p.gmailMessageId, p); },
      async prune() {}, async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
      async inheritRoles() { inheritRoles([...events.values()]); }, async finish() { return { events: events.size }; },
      ...(withContext ? { async contactAnchors(keys: string[]) {
        const m = new Map<string, ThreadAnchor>();
        for (const e of events.values()) for (const k of keys) if (e.signals.includes(k) && (!m.has(k) || (!m.get(k)!.company && e.company))) m.set(k, { gmailThreadId: e.gmailThreadId, company: e.company, role: e.role, confidence: e.confidence, fieldConfidence: e.fieldConfidence });
        return m;
      } } : {}),
    };
    await runSync(source, store, { maxCandidates: 5000, threadsPerChunk: chunk, budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract: extractAll, deferable: isContinuityCandidate, predict: buildPredictions, outboundEvent });
    for (const [k, v] of events) out.set(`${ds}|${k}`, v);
    for (const [id, p] of preds) if ((p.decision === "recruiting") !== events.has(id)) predMismatch += 1;
  }
  return { events: out, predMismatch };
}
console.log("\nCHUNK INVARIANCE (sweep, real engine):");
const base = await engineEvents(100000, true);
for (const c of [1, 5, 20, 100]) {
  for (const ctx of [false, true]) {
    const r = await engineEvents(c, ctx);
    const ids = new Set([...r.events.keys(), ...base.events.keys()]);
    let diff = 0; for (const id of ids) { const a = r.events.get(id), b = base.events.get(id); if (!a || !b || a.type !== b.type || (a.company ?? "") !== (b.company ?? "")) diff += 1; }
    console.log(`chunk ${String(c).padStart(3)} ${ctx ? "with stored context   " : "without stored context"}: events ${r.events.size} (one batch ${base.events.size}); differing from one batch ${diff}; prediction/event disagreements ${r.predMismatch}`);
  }
}

// 9. Grounding: is every company/role the reader shows traceable to the message (or the message it was linked to)?
import { groundingOf } from "../lib/reliability/grounding.ts";
{
  let n = 0, companyBad = 0, roleBad = 0, withCompany = 0, withRole = 0, linked = 0;
  for (const ds of DEV) {
    const batch = messages.filter((m) => m.ds === ds);
    const byId = new Map(batch.map((m) => [m.id, m]));
    for (const e of extractAll(batch.filter(category))) {
      const m = byId.get(e.gmailMessageId)!; n += 1;
      if (e.signals.some((s) => /continuity|reply-in/.test(s))) linked += 1;
      if (e.company) withCompany += 1; if (e.role) withRole += 1;
      const g = groundingOf(m, e);
      if (!g.company) companyBad += 1; if (!g.role) roleBad += 1;
    }
  }
  console.log(`\nGROUNDING over ${n} events (${linked} linked): company shown ${withCompany}, not traceable ${companyBad}; role shown ${withRole}, not traceable ${roleBad}`);
}

// 10. BEFORE vs AFTER through the real engine (sweep, chunk 20): silent errors vs visible uncertainty. Development data; regression numbers only.
import { readMail } from "../lib/reliability/assess.ts";
import { isNearMiss } from "../lib/reliability/flags.ts";
import { eventNeedsReview } from "../lib/recruiting/opportunity.ts";
import { DEFAULT_POLICY } from "../lib/recruiting/policy.ts";

async function pipeline(extract: typeof extractAll) {
  const out = new Map<string, ExtractedEvent>();
  for (const ds of DEV) {
    const mail = messages.filter((m) => m.ds === ds);
    const newest = (xs: Msg[]) => [...xs].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((e) => ({ id: e.id, threadId: e.threadId }));
    const source: MailSource = {
      async listCandidates() { return mergeTiers(newest(mail.filter((m) => matchesLegacyQuery(m.from, m.subject))), newest(mail.filter(category))); },
      async fetchEmails(ids) { return { emails: mail.filter((e) => ids.includes(e.id)), missing: [] }; },
      async fetchOutbound() { return []; },
    };
    const events = new Map<string, ExtractedEvent>(), preds = new Map<string, Prediction>();
    const store: SyncStore = {
      async evaluatedIds(ids) { return new Set(ids.filter((i) => preds.has(i))); },
      async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
      async savePredictions(ps) { for (const p of ps) if (!preds.has(p.gmailMessageId)) preds.set(p.gmailMessageId, p); },
      async prune() {}, async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
      async inheritRoles() { inheritRoles([...events.values()]); }, async finish() { return { events: events.size }; },
      async contactAnchors(keys: string[]) {
        const m = new Map<string, ThreadAnchor>();
        for (const e of events.values()) for (const k of keys) if (e.signals.includes(k) && (!m.has(k) || (!m.get(k)!.company && e.company))) m.set(k, { gmailThreadId: e.gmailThreadId, company: e.company, role: e.role, confidence: e.confidence, fieldConfidence: e.fieldConfidence });
        return m;
      },
    };
    await runSync(source, store, { maxCandidates: 5000, threadsPerChunk: 20, budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract, deferable: isContinuityCandidate, predict: buildPredictions, outboundEvent });
    for (const [k, v] of events) out.set(`${ds}|${k}`, v);
  }
  return out;
}
function score(label: string, evs: Map<string, ExtractedEvent>) {
  let tp = 0, silentMiss = 0, surfacedMiss = 0, fpVisible = 0, fpSilent = 0, nearNoise = 0, tpFlagged = 0;
  for (const m of messages) {
    const e = evs.get(`${m.ds}|${m.id}`);
    const near = e && isNearMiss(e);
    if (m.positive) {
      if (e && !near) { tp += 1; if (eventNeedsReview({ ...e, id: "x", corrected: false } as never, DEFAULT_POLICY) || !e.company) tpFlagged += 1; }
      else if (near) surfacedMiss += 1; else silentMiss += 1;
    } else if (e) {
      if (near) nearNoise += 1;
      else if (eventNeedsReview({ ...e, id: "x", corrected: false } as never, DEFAULT_POLICY) || !e.company) fpVisible += 1; else fpSilent += 1;
    }
  }
  const silent = silentMiss + fpSilent;
  console.log(`${label.padEnd(30)} found ${tp}/${positives.length} (${pct(tp, positives.length)})  misses: silent ${silentMiss}, surfaced ${surfacedMiss}  |  false positives: silent ${fpSilent}, visible in review ${fpVisible}  |  SILENT ERRORS ${silent}  |  review items: true events ${tpFlagged}, near-miss noise ${nearNoise}, near-miss hits ${surfacedMiss}`);
}
console.log("\nBEFORE vs AFTER (sweep, real engine, chunk 20; development data, regression numbers only):");
score("before (rule reader only)", await pipeline(extractAll));
score("after (reliability layer)", await pipeline(readMail));

// 11. Outcome-language conflict: an event typed as a non-ending type whose text carries outcome-closing language.
import { stripQuoted } from "../lib/recruiting/extract.ts";
const OUTCOME = [
  /\b(?:best of luck|wish you (?:all )?(?:the best|success|luck)|good luck)\b[^.\n]{0,40}\b(?:search|future|endeavou?rs|career|journey)\b/i,
  /\bfuture (?:endeavou?rs|opportunities)\b/i,
  /\b(?:other|another) (?:candidates?|applicants?)\b/i,
  /\b(?:not|isn't|aren't) (?:a |the )?(?:right |good |strong )?(?:fit|match)\b/i,
  /\b(?:keep|retain) (?:your )?(?:resume|resumé|cv|information|details) (?:on file|for future)\b/i,
];
const hasOutcome = (m: Msg) => { const t = stripQuoted(m.bodyText); return OUTCOME.some((r) => r.test(t)); };
{
  const tbl = new Map<string, { t: number; f: number; rej: number }>();
  let rejMistyped = 0, rejMistypedCaught = 0;
  for (const ds of DEV) {
    const batch = messages.filter((m) => m.ds === ds && category(m)); const byId = new Map(batch.map((m) => [m.id, m]));
    for (const e of extractAll(batch)) {
      const m = byId.get(e.gmailMessageId)!;
      if (["rejection", "offer", "withdrawn", "user_reply"].includes(e.type)) continue;
      const hit = hasOutcome(m);
      const b = tbl.get(e.type) ?? { t: 0, f: 0, rej: 0 };
      if (hit) { if (m.positive) b.t += 1; else b.f += 1; if (m.type === "rejection") b.rej += 1; }
      tbl.set(e.type, b);
      if (m.positive && m.type === "rejection") { rejMistyped += 1; if (hit) rejMistypedCaught += 1; }
    }
  }
  console.log(`\nOUTCOME-LANGUAGE CONFLICT (event typed as non-ending, text has outcome-closing language): per type: true recruiting flagged / false positive flagged / of which labelled rejection`);
  for (const [t, b] of tbl) if (b.t + b.f > 0) console.log(`  ${t.padEnd(22)} ${b.t} / ${b.f} / ${b.rej}`);
  console.log(`  labelled rejections typed as a non-ending type: ${rejMistyped}, caught by the conflict check: ${rejMistypedCaught}`);
}

// 12. Wider near-miss criteria, burden vs recovery on development data (rejected messages in the sweep).
const employment = (m: Msg) => processEvidence(m.subject, m.bodyText).employment;
const humanEmployer = (m: Msg) => isContinuityCandidate(m);
const wide: Array<[string, (m: Msg) => boolean]> = [
  ["O1 IMPORTANT ∧ employment object ∧ not bulk", (m) => important(m) && employment(m) && !bulk(m)],
  ["O2 = O1 ∧ (named person at employer-like domain ∨ ATS sender)", (m) => important(m) && employment(m) && !bulk(m) && (humanEmployer(m) || ats(m))],
  ["O3 employment ∧ named person at employer-like domain ∧ not bulk", (m) => employment(m) && !bulk(m) && humanEmployer(m)],
  ["O4 = O3 ∧ IMPORTANT", (m) => employment(m) && !bulk(m) && humanEmployer(m) && important(m)],
  ["O5 = (candidacy anchor ∧ IMPORTANT ∧ not bulk) ∨ O4", (m) => (anchor(m) && important(m) && !bulk(m)) || (employment(m) && !bulk(m) && humanEmployer(m) && important(m))],
];
console.log(`\nWIDER NEAR-MISS CRITERIA over ${rejected.length} rejected messages (${rejected.filter((m) => m.positive).length} recruiting):`);
for (const [name, f] of wide) { const fl = rejected.filter(f); const hit = fl.filter((m) => m.positive).length; console.log(`${name.padEnd(72)} flagged ${String(fl.length).padStart(3)} (${((1000 * fl.length) / messages.length).toFixed(0)}/1000) recovered ${hit} noise ${fl.length - hit}`); }

// 13. Candidate refinements, burden vs recovery on development data.
const ONBOARD = /\b(?:i-?9|background (?:check|verification|screening)|start date|first day|onboarding|new hire|eligibility to work)\b/i;
const employerKind = (m: Msg) => classifySender(parseSender(m.from).domain) === "employer";
const HIRING_BOX = /^(?:careers?|jobs?|recruit\w*|talent|hr|people|hiring|staffing)\b/i;
const personOrHiringBox = (m: Msg) => isContinuityCandidate(m) || (employerKind(m) && HIRING_BOX.test(parseSender(m.from).localPart));
const emp2 = (m: Msg) => employment(m) || ONBOARD.test(m.bodyText) || ONBOARD.test(m.subject);
const ref: Array<[string, (m: Msg) => boolean]> = [
  ["current weak tier: IMPORTANT ∧ employment ∧ ¬bulk ∧ (person ∨ ATS)", (m) => important(m) && employment(m) && !bulk(m) && (humanEmployer(m) || ats(m))],
  ["R1 = IMPORTANT ∧ employment|onboarding ∧ ¬bulk ∧ (person ∨ hiring mailbox ∨ ATS)", (m) => important(m) && emp2(m) && !bulk(m) && (personOrHiringBox(m) || ats(m))],
  ["R2 = R1 ∨ (ATS ∧ employment ∧ ¬bulk)", (m) => (important(m) && emp2(m) && !bulk(m) && (personOrHiringBox(m) || ats(m))) || (ats(m) && employment(m) && !bulk(m))],
];
console.log("\nREFINED NEAR-MISS (rejected messages):");
for (const [name, f] of ref) { const fl = rejected.filter(f); const hit = fl.filter((m) => m.positive).length; console.log(`${name.padEnd(82)} flagged ${String(fl.length).padStart(3)} (${((1000 * fl.length) / messages.length).toFixed(0)}/1000) recovered ${hit} noise ${fl.length - hit}`); }
const accepted2 = [...events.keys()].map((k) => { const [ds, id] = k.split("|"); return messages.find((x) => x.ds === ds && x.id === id)!; });
const T2 = accepted2.filter((m) => m.positive), F2 = accepted2.filter((m) => !m.positive);
const dm: Array<[string, (m: Msg) => boolean]> = [
  ["doubt v1: ¬candidacy ∧ ¬IMPORTANT", (m) => !anchor(m) && !important(m)],
  ["doubt v2: ¬(candidacy ∧ employment) ∧ ¬IMPORTANT", (m) => !(anchor(m) && employment(m)) && !important(m)],
];
console.log("MEMBERSHIP DOUBT (accepted events; flagged true / flagged false):");
for (const [name, f] of dm) console.log(`${name.padEnd(60)} true ${T2.filter(f).length}/${T2.length}  false ${F2.filter(f).length}/${F2.length}`);

// 14. Event-like without an employment object (course/event/promotion vocabulary, nothing about a job): flagged true / false among accepted events.
const evLike = (m: Msg) => { const p = processEvidence(m.subject, m.bodyText); return p.eventLike && !p.employment; };
console.log(`EVENT-LIKE WITHOUT EMPLOYMENT OBJECT (accepted events): true ${T2.filter(evLike).length}/${T2.length}  false ${F2.filter(evLike).length}/${F2.length}`);
