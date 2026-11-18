/**
 * Employer-resolution evaluation. Aggregates and case ids only; no message text is printed.
 *   synth-export <dir>   the redacted inputs for both synthetic sets (what a semantic model would see) and the guide
 *   synth <dir> [out]    score the synthetic sets (set A: lib/semantic/entity-set.ts, holdout: lib/identity/holdout-set.ts). `out` = a model's raw readings
 *   dev <labels.json>    score the DEVELOPMENT mailbox read-only from ~/.opportunity-inbox/eval (dev datasets only, never blind-*), with cached semantic outputs
 * Arms: rules+reliability (production), + identity layer, + semantic reader, + semantic reader + identity layer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyIdentity, type IdentityContext } from "../lib/identity/reconcile.ts";
import { HOLDOUT_CASES } from "../lib/identity/holdout-set.ts";
import { learnedMappings } from "../lib/identity/learned.ts";
import { readMail } from "../lib/reliability/assess.ts";
import { sameOrg } from "../lib/recruiting/reader/reconcile.ts";
import { getCached } from "../lib/recruiting/reader/cache.ts";
import type { RecruitingEmail, ExtractedEvent } from "../lib/recruiting/types.ts";
import { applyConsensus } from "../lib/semantic/consensus.ts";
import { reconcileReadings } from "../lib/semantic/employer.ts";
import { ENTITY_CASES, caseToEmail, type EntityCase } from "../lib/semantic/entity-set.ts";
import { SEMANTIC_GUIDE } from "../lib/semantic/guide-v2.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { verifyReading, type VerifiedReading } from "../lib/semantic/reading.ts";

type Truth = { id: string; recruiting: boolean; employer: string | null };
type Arm = { name: string; events: Map<string, ExtractedEvent> };

const isNear = (e: ExtractedEvent) => e.signals.includes("near_miss") || e.signals.includes("near_miss_weak");
const stateOf = (e: ExtractedEvent) => (!e.company ? "unknown" : e.signals.includes("identity:review") ? "review" : (e.fieldConfidence?.company ?? e.confidence) >= 0.6 ? "known" : "likely");
const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "n/a");

function measure(label: string, truths: Truth[], ev: Map<string, ExtractedEvent>) {
  let pos = 0, shown = 0, named = 0, right = 0, wrong = 0, unknown = 0, silentWrong = 0, wrongLikely = 0, wrongReview = 0, noneInvented = 0, noneTotal = 0, fp = 0, flagged = 0;
  const dist: Record<string, number> = { known: 0, likely: 0, review: 0, unknown: 0 };
  const wrongs: string[] = [];
  for (const t of truths) {
    const e = ev.get(t.id);
    const visible = !!e && !isNear(e);
    if (!t.recruiting) { if (visible) fp++; continue; }
    pos++;
    if (!visible) continue;
    shown++;
    const st = stateOf(e!);
    dist[st]++;
    if ((e!.reviewReasons ?? []).length > 0 || st !== "known") flagged++;
    if (t.employer) {
      named++;
      if (!e!.company) unknown++;
      else if (sameOrg(e!.company, t.employer)) right++;
      else { wrong++; wrongs.push(`${t.id}:${e!.company}[${st}]`); if (st === "known") silentWrong++; else if (st === "likely") wrongLikely++; else wrongReview++; }
    } else { noneTotal++; if (e!.company) { noneInvented++; wrongs.push(`${t.id}:${e!.company}[${st}](truth none)`); if (st === "known") silentWrong++; } }
  }
  console.log(`\n${label}`);
  console.log(`  recruiting shown ${pct(shown, pos)}  false positives ${fp}   employer named in truth: right ${pct(right, named)}  WRONG ${wrong}  unknown ${unknown}   invented where none ${noneInvented}/${noneTotal}`);
  console.log(`  states (of ${shown} shown): known ${dist.known}  likely ${dist.likely}  review ${dist.review}  unknown ${dist.unknown}   SILENT wrong (known) ${silentWrong}  wrong shown as likely ${wrongLikely}, as review ${wrongReview}   events with something to confirm ${flagged}`);
  if (wrongs.length) console.log(`  wrong/invented: ${wrongs.join(", ")}`);
}

function arms(emails: RecruitingEmail[], readings: Map<string, VerifiedReading>, ctx: IdentityContext): Arm[] {
  const byId = new Map(emails.map((e) => [e.id, e]));
  const base = readMail(emails);
  const sem = reconcileReadings(applyConsensus(base, emails, new Map([...readings].map(([k, v]) => [k, v.output] as const))), readings);
  const toMap = (es: ExtractedEvent[]) => new Map(es.map((e) => [e.gmailMessageId, e] as const));
  return [
    { name: "rules + reliability layer (production before this milestone)", events: toMap(base) },
    { name: "+ identity layer (graph, team names, vendors, trust ladder)", events: toMap(applyIdentity(base, byId, new Map(), ctx)) },
    ...(readings.size ? [
      { name: "+ semantic reader (previous milestone)", events: toMap(sem) },
      { name: "+ semantic reader + identity layer (this milestone)", events: toMap(applyIdentity(sem, byId, readings, ctx)) },
    ] : []),
  ];
}

const [mode, a, b] = process.argv.slice(2);
const ctxEmpty: IdentityContext = { known: [], learned: learnedMappings([]) };

if (mode === "synth-export" || mode === "synth") {
  const sets: Array<[string, EntityCase[]]> = [["A", ENTITY_CASES], ["H", HOLDOUT_CASES]];
  const all = sets.flatMap(([p, cs]) => cs.map((c) => ({ ...c, id: `${p}:${c.id}` })));
  const emails = all.map(caseToEmail);
  const inputs = semanticInputs(emails, ["Sam"]);
  if (mode === "synth-export") {
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, "inputs.json"), JSON.stringify(inputs.map((i) => ({ key: i.key, from: i.from, subject: i.subject, body: i.body, received: i.received, employer_candidates: i.candidates.map((c) => c.name) })), null, 1));
    writeFileSync(join(a, "guide.txt"), SEMANTIC_GUIDE);
    console.log(`exported ${inputs.length} of ${all.length}`);
    process.exit(0);
  }
  const readings = new Map<string, VerifiedReading>();
  const outFile = b ?? join(a, "out.json");
  if (existsSync(outFile)) {
    const raw: Array<Record<string, unknown>> = JSON.parse(readFileSync(outFile, "utf8"));
    const byKey = new Map(raw.map((r) => [String(r.key), r]));
    for (const i of inputs) readings.set(i.key, verifyReading(byKey.get(i.key), i));
  }
  for (const [p, cs, title] of [["A", ENTITY_CASES, "SET A (used while building; regression)"], ["H", HOLDOUT_CASES, "HOLDOUT (written before the resolver ran on it)"]] as const) {
    const ids = new Set(cs.map((c) => `${p}:${c.id}`));
    const emailsP = emails.filter((e) => ids.has(e.id));
    const truths: Truth[] = cs.map((c) => ({ id: `${p}:${c.id}`, recruiting: c.truth.recruiting, employer: c.truth.employer }));
    console.log(`\n=========== ${title} — ${cs.length} cases`);
    for (const arm of arms(emailsP, new Map([...readings].filter(([k]) => ids.has(k))), ctxEmpty)) measure(arm.name, truths, arm.events);
  }
  process.exit(0);
}

if (mode === "dev") {
  const DEV = ["dev-random-1", "validation-1", "validation-2"];
  const root = join(homedir(), ".opportunity-inbox", "eval");
  const rows = JSON.parse(readFileSync(a, "utf8")) as Array<{ ds: string; id: string; field: string; value: unknown }>;
  const rec = new Map<string, boolean>();
  const company = new Map<string, string>();
  for (const r of rows) {
    const k = `${r.ds}|${r.id}`;
    if (r.field === "is_recruiting") rec.set(k, r.value === true || r.value === "true");
    if (r.field === "company" && typeof r.value === "string" && r.value !== "not_applicable") company.set(k, r.value);
  }
  const gmail = JSON.parse(readFileSync(join(root, "dev-gmail-labels.json"), "utf8")) as Record<string, string[]>;
  const allBase: ExtractedEvent[] = [];
  const truths: Truth[] = [];
  const emailsAll: RecruitingEmail[] = [];
  const readings = new Map<string, VerifiedReading>();
  let cached = 0;
  for (const ds of DEV) {
    const manifest = JSON.parse(readFileSync(join(root, ds, "manifest.json"), "utf8")) as { memberIds: string[] };
    const members = new Set(manifest.memberIds);
    const emails: RecruitingEmail[] = [];
    for (const line of readFileSync(join(root, ds, "messages.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const m = JSON.parse(line) as RecruitingEmail & { receivedAt: string };
      if (!members.has(m.id) || m.outbound) continue;
      emails.push({ ...m, id: `${ds}|${m.id}`, threadId: `${ds}|${m.threadId}`, receivedAt: new Date(m.receivedAt), labels: gmail[`${ds}|${m.id}`] ?? [] });
      truths.push({ id: `${ds}|${m.id}`, recruiting: rec.get(`${ds}|${m.id}`) === true, employer: company.get(`${ds}|${m.id}`) ?? null });
    }
    emailsAll.push(...emails);
    for (const i of semanticInputs(emails, (process.env.READER_SELF_NAMES ?? "").split(",").filter(Boolean))) {
      const hit = getCached(i, "A");
      if (hit) { cached++; readings.set(i.key, { key: i.key, output: hit, entities: [], employer: hit.company && hit.status === "ok" && hit.recruiting ? { name: hit.company, basis: "hiring_for" } : null, rejections: [] }); }
    }
    allBase.push(...readMail(emails));
  }
  // the pipeline's own picture of "companies the person already has": confident rules events (no labels, no truth)
  const known = [...new Set(allBase.filter((e) => e.company && (e.fieldConfidence?.company ?? 0) >= 0.6).map((e) => e.company!))];
  console.log(`dev messages ${emailsAll.length} (recruiting ${truths.filter((t) => t.recruiting).length}); cached semantic outputs ${cached}; known companies from confident rules events ${known.length}`);
  const ctx: IdentityContext = { known, learned: learnedMappings([]) };
  if (process.env.DEBUG_IDS) {
    // sources, weights, candidate names and states only; no subject, sender line or body
    const { resolveIdentity } = await import("../lib/identity/resolver.ts");
    const { collectEvidence } = await import("../lib/recruiting/entity/resolve.ts");
    const base = new Map(allBase.map((e) => [e.gmailMessageId, e] as const));
    for (const id of process.env.DEBUG_IDS.split(",")) {
      const m = emailsAll.find((x) => x.id === id);
      if (!m) continue;
      const input = { from: m.from, subject: m.subject, body: m.bodyText, knownCompanies: known };
      const r = resolveIdentity(input);
      console.log(id, "truth:", truths.find((t) => t.id === id)?.employer, "| rules:", base.get(id)?.company, base.get(id)?.fieldConfidence?.company, "| evidence:", collectEvidence(input).evidence.map((e) => `${e.source}:${e.name}:${e.weight}`).join(" ; "), "| ->", r.state, r.employer?.name, r.score, r.classes.join("+"), "| interm:", r.intermediaries.map((i) => `${i.name}:${i.kind}`).join(","));
    }
    process.exit(0);
  }
  for (const arm of arms(emailsAll, readings, ctx)) measure(arm.name, truths, arm.events);
  process.exit(0);
}
console.log("usage: identity-eval.ts synth-export <dir> | synth <dir> [out.json] | dev <labels.json>");
