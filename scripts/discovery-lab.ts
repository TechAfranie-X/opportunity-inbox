/**
 * Discovery lab: measures how much recruiting mail each candidate-generation strategy reaches, on DEVELOPMENT datasets only.
 *
 * Inputs (local, outside the repo): ~/.opportunity-inbox/eval/<dataset>/messages.jsonl, the Gmail label map, and a labels
 * export. Output is aggregate counts only: no subject, sender, body or message id is printed.
 *
 *   node --import ./scripts/loader/register.mjs scripts/discovery-lab.ts <labels.json>
 *
 * Refuses the evaluation datasets (blind-*): they are not development data.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractAll, extractWithReason } from "../lib/recruiting/extract.ts";
import { matchesLegacyQuery } from "../lib/discovery/legacy-query.ts";
import type { RecruitingEmail } from "../lib/recruiting/types.ts";

const DEV = ["dev-random-1", "validation-1", "validation-2"] as const;
const root = join(homedir(), ".opportunity-inbox", "eval");
const labelsFile = process.argv[2];
if (!labelsFile) throw new Error("usage: discovery-lab.ts <labels.json>");

type Row = { ds: string; id: string; field: string; value: unknown };
const labelRows = JSON.parse(readFileSync(labelsFile, "utf8")) as Row[];
const gmailLabels = JSON.parse(readFileSync(join(root, "dev-gmail-labels.json"), "utf8")) as Record<string, string[]>;

const isRecruiting = new Map<string, boolean>();
for (const r of labelRows) if (r.field === "is_recruiting") isRecruiting.set(`${r.ds}|${r.id}`, r.value === true || r.value === "true");

type Msg = RecruitingEmail & { ds: string; labels: string[]; positive: boolean };
const messages: Msg[] = [];
for (const ds of DEV) {
  const manifest = JSON.parse(readFileSync(join(root, ds, "manifest.json"), "utf8")) as { memberIds: string[] };
  const members = new Set(manifest.memberIds);
  for (const line of readFileSync(join(root, ds, "messages.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const m = JSON.parse(line) as RecruitingEmail & { receivedAt: string };
    if (!members.has(m.id) || m.outbound) continue;
    const key = `${ds}|${m.id}`;
    messages.push({ ...m, receivedAt: new Date(m.receivedAt), ds, labels: gmailLabels[key] ?? [], positive: isRecruiting.get(key) === true });
  }
}

const pct = (k: number, n: number) => (n === 0 ? "n/a" : `${((100 * k) / n).toFixed(1)}%`);
const count = (xs: Msg[], f: (m: Msg) => boolean) => xs.filter(f).length;

const positives = messages.filter((m) => m.positive);
console.log(`dev inbound messages: ${messages.length}; labeled recruiting: ${positives.length}`);

// ---- Strategy gates (what would be fetched with a body)
const category = (m: Msg) => m.labels.includes("CATEGORY_UPDATES") || m.labels.includes("CATEGORY_PERSONAL") || (m.labels.includes("INBOX") && !m.labels.some((l) => /CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)/.test(l)));
const gates: Array<[string, (m: Msg) => boolean]> = [
  ["legacy subject/ATS query", (m) => matchesLegacyQuery(m.from, m.subject)],
  ["Gmail categories: Primary+Updates", category],
  ["everything (upper bound)", () => true],
];
console.log("\nGATE                                  fetched%   recall of recruiting");
for (const [name, g] of gates) {
  console.log(`${name.padEnd(38)}${pct(count(messages, g), messages.length).padEnd(11)}${count(positives, g)}/${positives.length} (${pct(count(positives, g), positives.length)})`);
}

// ---- The rules reader as the precision stage, behind each gate, using the product's thread-aware path (extractAll)
console.log("\nRULES READER BEHIND EACH GATE (development data, fitted: a regression guard, not an accuracy claim)");
function predictedBehind(gate: (m: Msg) => boolean): Set<Msg> {
  const out = new Set<Msg>();
  for (const ds of DEV) {
    const batch = messages.filter((m) => m.ds === ds && gate(m));
    const events = new Set(extractAll(batch).map((e) => e.gmailMessageId));
    for (const m of batch) if (events.has(m.id)) out.add(m);
  }
  return out;
}
const predictions = new Map<string, Set<Msg>>();
for (const [name, g] of gates) {
  const predicted = predictedBehind(g);
  predictions.set(name, predicted);
  const tp = [...predicted].filter((m) => m.positive).length;
  const fp = predicted.size - tp;
  console.log(`${name.padEnd(38)}TP ${tp}  FP ${fp}  FN ${positives.length - tp}  precision ${pct(tp, tp + fp)}  recall ${pct(tp, positives.length)}`);
}
const verdict = new Map<Msg, boolean>();
for (const m of messages) verdict.set(m, predictions.get("everything (upper bound)")!.has(m));

// ---- What still fails when everything is fetched (reader-side failures), by the reader's own stated reason
const everything = predictions.get("everything (upper bound)")!;
const fnReasons = new Map<string, number>();
for (const m of positives) if (!everything.has(m)) {
  const r = extractWithReason(m);
  const key = r.event ? "accepted alone, dropped in batch" : r.reason;
  fnReasons.set(key, (fnReasons.get(key) ?? 0) + 1);
}
console.log(`\nreader misses with everything fetched (${positives.length - [...everything].filter((m) => m.positive).length}), by rejection reason: ${[...fnReasons].map(([k, v]) => `${k}=${v}`).join(", ")}`);
const fpTypes = new Map<string, number>();
for (const m of everything) if (!m.positive) {
  const e = extractWithReason(m).event;
  const key = `${e?.type ?? "thread-continuity"}${m.labels.includes("CATEGORY_PROMOTIONS") ? "/promo" : ""}`;
  fpTypes.set(key, (fpTypes.get(key) ?? 0) + 1);
}
console.log(`reader false positives with everything fetched (${[...everything].filter((m) => !m.positive).length}), by type: ${[...fpTypes].map(([k, v]) => `${k}=${v}`).join(", ")}`);

// ---- Who is missed by the legacy query, and would the reader have understood them?
const missed = positives.filter((m) => !matchesLegacyQuery(m.from, m.subject));
console.log(`\nlegacy query misses ${missed.length}/${positives.length} recruiting messages`);
console.log(`  of those, the rules reader would accept: ${count(missed, (m) => verdict.get(m)!)}`);
const byCat = new Map<string, number>();
for (const m of missed) {
  const c = m.labels.find((l) => l.startsWith("CATEGORY_")) ?? "no category";
  byCat.set(c, (byCat.get(c) ?? 0) + 1);
}
console.log(`  by Gmail category: ${[...byCat].map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`  reached by Primary+Updates gate: ${count(missed, category)}/${missed.length}`);

// ---- Near-miss tier: rejected messages that still carry hiring evidence (review burden vs recruiting recovered)
import { triage } from "../lib/recruiting/reader/triage.ts";
const rejected = messages.filter((m) => !everything.has(m));
const tiers: Array<[string, (m: Msg) => boolean]> = [
  ["R1 hiring vocabulary or ATS sender", (m) => triage(m).reason === "protected"],
  ["R2 = R1 and reader saw no recruiting language/context", (m) => triage(m).reason === "protected" && ["no_recruiting_language", "no_recruiting_context"].includes((extractWithReason(m).reason as string) ?? "")],
  ["R3 = R2 and Primary/Updates", (m) => category(m) && triage(m).reason === "protected" && ["no_recruiting_language", "no_recruiting_context"].includes((extractWithReason(m).reason as string) ?? "")],
];
console.log(`\nNEAR-MISS TIERS over ${rejected.length} rejected messages (${positives.length - [...everything].filter((m) => m.positive).length} are recruiting)`);
for (const [name, f] of tiers) {
  const flagged = rejected.filter(f);
  const hit = flagged.filter((m) => m.positive).length;
  console.log(`${name.padEnd(56)}flagged ${String(flagged.length).padStart(3)} (${((1000 * flagged.length) / messages.length).toFixed(0)}/1000)  recruiting recovered ${hit}  noise ${flagged.length - hit}`);
}

// ---- Trust on what IS found: company correctness vs the review flag (development labels; aggregate only)
import { eventNeedsReview } from "../lib/recruiting/opportunity.ts";
import { DEFAULT_POLICY } from "../lib/recruiting/policy.ts";
const labelCompany = new Map<string, string>();
for (const r of labelRows) if (r.field === "company" && typeof r.value === "string") labelCompany.set(`${r.ds}|${r.id}`, r.value);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
let tpCount = 0, exact = 0, lenient = 0, wrong = 0, wrongFlagged = 0, unnamed = 0, flaggedRight = 0;
for (const ds of DEV) {
  const batch = messages.filter((m) => m.ds === ds);
  const byId = new Map(batch.map((m) => [m.id, m]));
  for (const e of extractAll(batch)) {
    const m = byId.get(e.gmailMessageId);
    if (!m || !m.positive) continue;
    tpCount += 1;
    const truth = labelCompany.get(`${ds}|${m.id}`);
    const flagged = eventNeedsReview({ ...e, corrected: false, confirmed: false } as never, DEFAULT_POLICY) || !e.company;
    if (!e.company) { unnamed += 1; continue; }
    if (!truth || /^(unknown|none)/i.test(truth)) continue;
    const a = norm(e.company), b = norm(truth);
    if (a === b) exact += 1;
    if (a === b || a.includes(b) || b.includes(a)) lenient += 1;
    else { wrong += 1; if (flagged) wrongFlagged += 1; }
    if (flagged && (a === b || a.includes(b) || b.includes(a))) flaggedRight += 1;
  }
}
console.log(`\nCOMPANY ON FOUND RECRUITING MESSAGES (n=${tpCount}; development labels)`);
console.log(`  named+labelled exact ${exact}, lenient ${lenient}, wrong ${wrong} (flagged for review ${wrongFlagged}, UNFLAGGED confident-wrong ${wrong - wrongFlagged}), reader gave no company ${unnamed}, right-but-flagged ${flaggedRight}`);

// ---- Does the review queue already catch the sweep's extra false positives? (events behind the category gate, by provenance)
console.log("\nPROVENANCE OF ACCEPTED EVENTS BEHIND THE CATEGORY GATE");
const sweepGate = gates[1][1];
const rows: Array<{ via: string; positive: boolean; flagged: boolean }> = [];
for (const ds of DEV) {
  const batch = messages.filter((m) => m.ds === ds && sweepGate(m));
  const byId = new Map(batch.map((m) => [m.id, m]));
  for (const e of extractAll(batch)) {
    const m = byId.get(e.gmailMessageId);
    if (!m) continue;
    const flagged = !e.company || eventNeedsReview({ ...e, corrected: false, confirmed: false } as never, DEFAULT_POLICY);
    rows.push({ via: matchesLegacyQuery(m.from, m.subject) ? "keyword" : "sweep-only", positive: m.positive, flagged });
  }
}
for (const via of ["keyword", "sweep-only"]) {
  const r = rows.filter((x) => x.via === via);
  const fp = r.filter((x) => !x.positive);
  console.log(`${via.padEnd(11)} events ${r.length}  recruiting ${r.length - fp.length}  false positives ${fp.length} (in review queue ${fp.filter((x) => x.flagged).length}, shown as fact ${fp.filter((x) => !x.flagged).length})  true events shown in review ${r.filter((x) => x.positive && x.flagged).length}`);
}

// ---- THE REAL ENGINE, both modes, over each development dataset (the before/after)
import { runSync, type MailSource, type SyncStore } from "../lib/recruiting/sync-engine.ts";
import { mergeTiers } from "../lib/discovery/strategy.ts";
import { buildPredictions, type Prediction } from "../lib/recruiting/predictions.ts";
import { inheritRoles, outboundEvent, type ThreadAnchor } from "../lib/recruiting/extract.ts";
import type { ExtractedEvent } from "../lib/recruiting/types.ts";

async function engineRun(mode: "keyword" | "sweep") {
  let tp = 0, fp = 0, fetched = 0, rejectedWithDomain = 0, rejectedSweep = 0;
  const via = { keyword: 0, sweep: 0 };
  for (const ds of DEV) {
    const mail = messages.filter((m) => m.ds === ds);
    const newest = (xs: Msg[]) => [...xs].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).map((e) => ({ id: e.id, threadId: e.threadId }));
    const source: MailSource = {
      async listCandidates() {
        const keyword = newest(mail.filter((m) => matchesLegacyQuery(m.from, m.subject)));
        return mode === "sweep" ? mergeTiers(keyword, newest(mail.filter(category))) : keyword;
      },
      async fetchEmails(ids) { fetched += ids.length; return { emails: mail.filter((e) => ids.includes(e.id)), missing: [] }; },
      async fetchOutbound() { return []; },
    };
    const events = new Map<string, ExtractedEvent>(), preds = new Map<string, Prediction>();
    const store: SyncStore = {
      async evaluatedIds(ids) { return new Set(ids.filter((i) => preds.has(i))); },
      async saveEvents(es) { for (const e of es) events.set(e.gmailMessageId, e); },
      async savePredictions(ps) { for (const p of ps) preds.set(p.gmailMessageId, p); },
      async prune() {}, async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
      async inheritRoles() { inheritRoles([...events.values()]); }, async finish() { return { events: events.size }; },
    };
    await runSync(source, store, { maxCandidates: 5000, threadsPerChunk: Number(process.env.CHUNK ?? 20), budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract: extractAll, predict: buildPredictions, outboundEvent });
    const truth = new Map(mail.map((m) => [m.id, m.positive]));
    for (const e of events.values()) {
      if (truth.get(e.gmailMessageId)) tp += 1; else fp += 1;
      const v = e.signals.find((s) => s.startsWith("via:")); if (v) via[v.slice(4) as "keyword" | "sweep"] += 1;
    }
    for (const p of preds.values()) if (p.decision === "not_recruiting" && p.signals.includes("via:sweep")) { rejectedSweep += 1; if (p.senderDomain) rejectedWithDomain += 1; }
  }
  return { tp, fp, fn: positives.length - tp, fetched, via, rejectedSweep, rejectedWithDomain };
}
console.log("\nREAL SYNC ENGINE (development data; reader fitted to this data, so recall/precision here are regression numbers, not accuracy claims)");
for (const mode of ["keyword", "sweep"] as const) {
  const r = await engineRun(mode);
  console.log(`${mode.padEnd(8)} found ${r.tp}/${positives.length} recruiting (${pct(r.tp, positives.length)})  false positives ${r.fp}  precision ${pct(r.tp, r.tp + r.fp)}  messages read ${r.fetched} (${pct(r.fetched, messages.length)} of mailbox)  events by tier ${JSON.stringify(r.via)}  sweep-rejected rows ${r.rejectedSweep}, keeping a sender domain: ${r.rejectedWithDomain}`);
}

// ---- Is the reader's output a function of how the sync was cut into chunks? (company/type per message, small chunks vs one batch)
async function engineEvents(chunk: number) {
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
      async savePredictions(ps) { for (const p of ps) preds.set(p.gmailMessageId, p); },
      async prune() {}, async recentAnchors(): Promise<ThreadAnchor[]> { return []; },
      async inheritRoles() { inheritRoles([...events.values()]); }, async finish() { return { events: events.size }; },
    };
    await runSync(source, store, { maxCandidates: 5000, threadsPerChunk: chunk, budgetMs: 1e12, recentDays: 30, embargoBefore: null, extract: extractAll, predict: buildPredictions, outboundEvent });
    for (const [k, v] of events) out.set(`${ds}|${k}`, v);
  }
  return out;
}
{
  const small = await engineEvents(20), whole = await engineEvents(100000);
  const ids = new Set([...small.keys(), ...whole.keys()]);
  let onlyWhole = 0, onlySmall = 0, typeDiff = 0, companyDiff = 0, both = 0;
  for (const id of ids) {
    const a = small.get(id), b = whole.get(id);
    if (a && b) { both += 1; if (a.type !== b.type) typeDiff += 1; if ((a.company ?? "") !== (b.company ?? "")) companyDiff += 1; }
    else if (b) onlyWhole += 1; else onlySmall += 1;
  }
  const sig = new Map<string, number>();
  for (const id of ids) if (whole.get(id) && !small.get(id)) { const k = whole.get(id)!.signals.filter((x) => /continuity|reply-in/.test(x)).join("+") || "classified-on-its-own-text"; sig.set(k, (sig.get(k) ?? 0) + 1); }
  console.log(`events recovered only by one batch, by how they were linked: ${[...sig].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`\nCHUNK DEPENDENCE (sweep mode, chunks of 20 threads vs one batch): events in both ${both}; only with one batch ${onlyWhole}; only with chunks ${onlySmall}; type differs ${typeDiff}; company differs ${companyDiff}`);
}

// ---- OPPORTUNITY-LEVEL recall: the product's unit is the opportunity, not the email. How many whole opportunities are invisible?
{
  const ref = new Map<string, string>();
  for (const r of labelRows) if (r.field === "opportunity_ref" && typeof r.value === "string" && r.value.trim()) ref.set(`${r.ds}|${r.id}`, `${r.ds}|${r.value.trim().toLowerCase()}`);
  const opps = new Map<string, Msg[]>();
  for (const m of positives) { const k = ref.get(`${m.ds}|${m.id}`) ?? `${m.ds}|solo:${m.id}`; opps.set(k, [...(opps.get(k) ?? []), m]); }
  const sizes = [...opps.values()].map((x) => x.length);
  console.log(`\nOPPORTUNITIES (labelled recruiting messages grouped by the labeller's opportunity id): ${opps.size} opportunities from ${positives.length} messages; with 2+ messages: ${sizes.filter((n) => n > 1).length}`);
  for (const mode of ["keyword", "sweep"] as const) {
    const found = mode === "keyword" ? new Set([...predictions.get("legacy subject/ATS query")!]) : new Set([...predictions.get("Gmail categories: Primary+Updates")!]);
    const seen = [...opps.values()].filter((ms) => ms.some((m) => found.has(m))).length;
    const full = [...opps.values()].filter((ms) => ms.every((m) => found.has(m))).length;
    console.log(`${mode.padEnd(8)} opportunities with at least one message found: ${seen}/${opps.size} (${pct(seen, opps.size)}) — INVISIBLE: ${opps.size - seen};  with every message found: ${full}/${opps.size} (${pct(full, opps.size)})`);
  }
}
