/* eslint-disable @typescript-eslint/no-unused-expressions -- dense research harness: counters are bumped with ternaries */
// Architecture lab: offline analysis of the two-reader system on DEVELOPMENT datasets only.
//   npm run arch -- diagnose            error structure, disagreement outcomes, gate dependence
//   (other commands are added as designs are compared)
// Reads only the local snapshots, the labels and the reader cache. Refuses blind datasets.
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { evalDatasets, labels as L } from "../lib/db/schema.ts";
import { latestLabels } from "../lib/eval-store/label-audit.ts";
import { readSnapshot } from "../lib/eval-store/snapshot.ts";
import { resolveBatch } from "../lib/recruiting/entity/resolve.ts";
import { buildPredictions } from "../lib/recruiting/predictions.ts";
import type { RecruitingEmail } from "../lib/recruiting/types.ts";
import { getCached } from "../lib/recruiting/reader/cache.ts";
import { passGate } from "../lib/recruiting/reader/gate.ts";
import { sha } from "../lib/recruiting/reader/guide.ts";
import { reconcile, sameOrg } from "../lib/recruiting/reader/reconcile.ts";
import { buildReaderInput } from "../lib/recruiting/reader/redact.ts";
import type { ReaderInput, VerifiedOutput } from "../lib/recruiting/reader/types.ts";

export const DEV = ["dev-random-1", "validation-1", "validation-2"];
// Redaction names come from the environment (.env.local, never committed). The cached development model outputs are keyed on
// the exact redacted input, so they are reproduced only with the same names the development reads used.
export const SELF = (process.env.READER_SELF_NAMES ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (SELF.length === 0) throw new Error("set READER_SELF_NAMES (comma-separated name tokens to redact) in .env.local");

export type Row = {
  ds: string; id: string; email: RecruitingEmail; label: Record<string, unknown>; yes: boolean;
  rulesYes: boolean; rulesType: string | null; candidates: string[]; threadMessages: number; key: string; input: ReaderInput;
  domain: string; model: VerifiedOutput | null; modelAll: VerifiedOutput | null; gateG1: boolean; rulesConf: number; rulesSignals: string[]; replied: boolean; threadMates: RecruitingEmail[];
};

export const domainOf = (from: string) => ((from.match(/@([\w.-]+)/)?.[1] ?? "?").toLowerCase().split(".").slice(-2).join("."));

export async function loadDev(datasets = DEV): Promise<Row[]> {
  const db = getDb();
  const rows: Row[] = [];
  for (const name of datasets) {
    if (!DEV.includes(name)) throw new Error(`refusing to load "${name}": the architecture lab is for development datasets only`);
    const [ds] = await db.select().from(evalDatasets).where(eq(evalDatasets.name, name));
    if (ds.kind === "blind") throw new Error("refusing blind dataset");
    const lab = latestLabels((await db.select().from(L).where(eq(L.datasetId, ds.id))).map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field, value: r.value, createdAt: r.createdAt })));
    const { members, context } = readSnapshot(name);
    const all = [...members, ...context];
    const preds = new Map(buildPredictions(all).map((p) => [p.gmailMessageId, p]));
    const res = resolveBatch(all.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, replyTo: e.replyTo, subject: e.subject, body: e.bodyText })));
    const per = new Map<string, number>();
    for (const m of all) per.set(m.threadId, (per.get(m.threadId) ?? 0) + 1);
    for (const m of members) {
      const p = preds.get(m.id), r = res.get(m.id);
      const names: string[] = [];
      for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name), ...(r?.evidence ?? []).filter((e) => e.weight >= 0.3).map((e) => e.name)]) if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
      const key = `m${sha(`${name}:${m.id}`).slice(0, 8)}`;
      const input = buildReaderInput(m, key, names, per.get(m.threadId) ?? 1, SELF);
      const rulesYes = p?.decision === "recruiting";
      const gateG1 = passGate("G1-process", m, rulesYes);
      rows.push({ ds: name, id: m.id, email: m, label: lab.get(m.id) ?? {}, yes: lab.get(m.id)?.is_recruiting === true, rulesYes, rulesType: p?.type ?? null, candidates: names, threadMessages: per.get(m.threadId) ?? 1, key, input, domain: domainOf(m.from), model: gateG1 ? getCached(input, "A") : null, modelAll: getCached(input, "A"), gateG1, rulesConf: p?.confidence ?? 0, rulesSignals: p?.signals ?? [], replied: all.some((x) => x.threadId === m.threadId && x.outbound), threadMates: all.filter((x) => x.threadId === m.threadId) });
    }
  }
  return rows;
}

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "n/a") + ` (${k}/${n})`;
const bump = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const top = (o: Record<string, number>, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ");
const modelYes = (m: VerifiedOutput | null) => !!m && m.status === "ok" && m.recruiting;

if (process.argv[2] === "diagnose") {
  const rows = await loadDev();
  const pos = rows.filter((r) => r.yes);
  console.log(`dev: ${rows.length} messages, ${pos.length} positives; model outputs available for ${rows.filter((r) => r.model).length} (gate G1)`);

  // 1) Component errors
  const conf = (f: (r: Row) => boolean, rs = rows) => { let tp = 0, fp = 0, fn = 0, tn = 0; for (const r of rs) { const p = f(r); if (r.yes) p ? tp++ : fn++; else p ? fp++ : tn++; } return { tp, fp, fn, tn }; };
  const show = (name: string, c: { tp: number; fp: number; fn: number; tn: number }) => console.log(`${name.padEnd(34)} P ${pct(c.tp, c.tp + c.fp)}  R ${pct(c.tp, c.tp + c.fn)}  TP/FP/FN/TN ${c.tp}/${c.fp}/${c.fn}/${c.tn}`);
  show("rules (all)", conf((r) => r.rulesYes));
  show("model (all, ungated = no)", conf((r) => modelYes(r.model)));
  show("model within gate G1", conf((r) => modelYes(r.model), rows.filter((r) => r.gateG1)));
  show("rules within gate G1", conf((r) => r.rulesYes, rows.filter((r) => r.gateG1)));

  // 2) Disagreement outcomes (rules vs verified model, both defined)
  const cells: Record<string, number> = {};
  for (const r of rows.filter((x) => x.gateG1)) {
    const ab = r.model && (r.model.status !== "ok" || r.model.certainty === "low");
    cells[`${r.yes ? "POS" : "neg"} rules=${r.rulesYes ? "Y" : "n"} model=${ab ? "abstain" : modelYes(r.model) ? "Y" : "n"}`] = (cells[`${r.yes ? "POS" : "neg"} rules=${r.rulesYes ? "Y" : "n"} model=${ab ? "abstain" : modelYes(r.model) ? "Y" : "n"}`] ?? 0) + 1;
  }
  console.log("\nwithin gate (label / rules / model):");
  for (const k of Object.keys(cells).sort()) console.log(`  ${k.padEnd(28)} ${cells[k]}`);
  let dis = 0, rulesRight = 0, modelRight = 0;
  for (const r of rows.filter((x) => x.gateG1 && x.model)) { const m = r.model!; if (m.status !== "ok" || m.certainty === "low") continue; if (r.rulesYes !== m.recruiting) { dis++; if (r.rulesYes === r.yes) rulesRight++; else modelRight++; } }
  console.log(`disagreements (model confident): ${dis}; rules right ${rulesRight}, model right ${modelRight}`);

  // 3) Who is wrong, by sender family
  const rFP: Record<string, number> = {}, mFP: Record<string, number> = {}, rFN: Record<string, number> = {}, mFN: Record<string, number> = {};
  for (const r of rows) { if (!r.yes && r.rulesYes) bump(rFP, r.domain); if (!r.yes && modelYes(r.model)) bump(mFP, r.domain); if (r.yes && !r.rulesYes) bump(rFN, r.domain); if (r.yes && !modelYes(r.model)) bump(mFN, r.domain); }
  console.log(`\nrules FP by domain:  ${top(rFP)}`); console.log(`model FP by domain:  ${top(mFP)}`);
  console.log(`rules FN by domain:  ${top(rFN)}`); console.log(`model FN by domain:  ${top(mFN)}`);

  // 4) Gate dependence
  const ungated = pos.filter((r) => !r.gateG1).length;
  const viaShortcutOnly = pos.filter((r) => r.gateG1 && !passGate("G1-process", r.email, false)).length;
  console.log(`\ngate G1: positives not gated ${ungated}; positives gated ONLY because rules said yes ${viaShortcutOnly} of ${pos.length}`);
  const sc = rows.filter((r) => r.gateG1 && !passGate("G1-process", r.email, false));
  console.log(`messages gated only by the rules shortcut: ${sc.length} (positives ${sc.filter((r) => r.yes).length})`);

  // 5) Reconcile (frozen) outcome per label
  const rc: Record<string, number> = {};
  for (const r of rows) { const x = reconcile({ recruiting: r.rulesYes, type: null, company: null, role: null }, r.model); bump(rc, `${r.yes ? "POS" : "neg"}:${x.state}`); }
  console.log(`frozen reconcile states: ${top(rc, 12)}`);
  process.exit(0);
}

if (process.argv[2] === "triage-proto") {
  const rows = await loadDev();
  const NOISE = /(\d+\s?%\s?off|\bsale\b|\bdeals?\b|shop (now|the)|free shipping|promo code|coupon|limited[- ]time|order (confirmation|#|number|has shipped|status)|tracking (number|id)|out for delivery|\breceipt\b|\bstatement\b|password (reset|change|was changed|has been changed)|verification code|security (alert|code)|one[- ]time (code|passcode)|view (this )?(email )?in (your )?browser|manage (your )?(email )?preferences|newsletter|weekly digest|playlist|rewards? points?|gift card|your (cart|subscription|trip|flight|reservation|booking)|transfer (#|to)|\bcheckout\b)/i;
  const PROTECT = /(greenhouse|lever\.co|ashbyhq|icims|myworkday|workday|smartrecruiters|jobvite|taleo|successfactors|handshake|interfolio|modernloop|hackerrank|codesignal|hirevue|12twenty|oraclecloud|brassring|breezy|workable|bamboohr)/i;
  const HIRE = /\b(appl(y|ied|ies|ication|ications|icant|icants|ying)|candidate|candidacy|interview|assessment|coding challenge|recruit\w*|hiring|talent|resume|offer (letter|of employment)|background (check|verification|screen\w*)|onboarding|i-?9|new hire|start date|employment|internship|fellowship|position|opening|requisition|next steps)\b/i;
  const pass = (r: Row) => PROTECT.test(r.email.from) || !NOISE.test(`${r.email.subject}\n${r.email.bodyText.slice(0, 2500)}`) || HIRE.test(`${r.email.subject}\n${r.email.bodyText.slice(0, 2500)}`);
  const pos = rows.filter((r) => r.yes);
  for (const [name, f] of [["G1 (frozen)", (r: Row) => r.gateG1], ["G0-loose", (r: Row) => passGate("G0-loose", r.email, r.rulesYes)], ["negative-evidence triage", pass]] as const) {
    const cov = rows.filter(f).length, caught = pos.filter(f).length;
    console.log(`${name.padEnd(28)} coverage ${pct(cov, rows.length)}  recall ${pct(caught, pos.length)}  newly-read vs G1: ${rows.filter((r) => f(r) && !r.gateG1).length}`);
  }
  for (const ds of DEV) { const rs = rows.filter((r) => r.ds === ds); console.log(`  ${ds.padEnd(14)} triage coverage ${pct(rs.filter(pass).length, rs.length)} recall ${pct(rs.filter((r) => r.yes && pass(r)).length, rs.filter((r) => r.yes).length)}`); }
  const missed = pos.filter((r) => !pass(r)); console.log(`positives missed by triage: ${missed.length}`);
  process.exit(0);
}

if (process.argv[2] === "stress-det") {
  const { STRESS_SET, stressEmail } = await import("../lib/recruiting/reader/stress-set.ts");
  const emails = STRESS_SET.map(stressEmail);
  const preds = new Map(buildPredictions(emails).map((p) => [p.gmailMessageId, p]));
  const by: Record<string, { n: number; pos: number; rulesYes: number; rulesRight: number; g1: number; g1pos: number; g1posNoRules: number; g0: number }> = {};
  for (const c of STRESS_SET) {
    const e = emails.find((x) => x.id === `stress-${c.id}`)!;
    const ry = preds.get(e.id)?.decision === "recruiting";
    const b = (by[c.cls] ??= { n: 0, pos: 0, rulesYes: 0, rulesRight: 0, g1: 0, g1pos: 0, g1posNoRules: 0, g0: 0 });
    b.n++; if (c.yes) b.pos++; if (ry) b.rulesYes++; if (ry === c.yes) b.rulesRight++;
    if (passGate("G1-process", e, ry)) { b.g1++; } if (c.yes && passGate("G1-process", e, ry)) b.g1pos++; if (c.yes && passGate("G1-process", e, false)) b.g1posNoRules++; if (passGate("G0-loose", e, false)) b.g0++;
    if (process.argv[3] === "-v" && ry !== c.yes) console.log(`  rules wrong: ${c.id} (${c.cls}) label=${c.yes} rules=${ry} type=${preds.get(e.id)?.type}`);
  }
  console.log("class       n  pos  rules-right  rules-yes  G1-pass  G1-pos(with shortcut)  G1-pos(no shortcut)  G0-pass");
  for (const [k, b] of Object.entries(by)) console.log(`${k.padEnd(10)} ${String(b.n).padStart(2)}  ${String(b.pos).padStart(3)}  ${String(b.rulesRight).padStart(6)}/${b.n}    ${String(b.rulesYes).padStart(6)}   ${String(b.g1).padStart(6)}  ${String(b.g1pos).padStart(10)}/${b.pos}          ${String(b.g1posNoRules).padStart(9)}/${b.pos}        ${String(b.g0).padStart(6)}`);
  const all = Object.values(by).reduce((a, b) => ({ n: a.n + b.n, pos: a.pos + b.pos, rulesYes: a.rulesYes + b.rulesYes, rulesRight: a.rulesRight + b.rulesRight, g1: 0, g1pos: a.g1pos + b.g1pos, g1posNoRules: a.g1posNoRules + b.g1posNoRules, g0: 0 }));
  console.log(`ALL: rules right ${all.rulesRight}/${all.n}; positives reaching the model under G1: ${all.g1pos}/${all.pos} (without the rules shortcut: ${all.g1posNoRules}/${all.pos})`);
  process.exit(0);
}


// ---- policy comparison over the complete reference reads ----
type Dec = "yes" | "no" | "review";
const abst = (m: VerifiedOutput | null) => !m || m.status !== "ok" || m.certainty === "low";
export const POLICIES: Record<string, (r: Row) => Dec> = {
  "P0 frozen (G1 gate, rules-shortcut, review on disagree)": (r) => { const m = r.model; if (m && abst(m)) return "review"; const my = m ? m.recruiting : false; return r.rulesYes !== my ? "review" : r.rulesYes ? "yes" : "no"; },
  "P1 consensus, model reads everything": (r) => { const m = r.modelAll; if (abst(m)) return "review"; return r.rulesYes !== m!.recruiting ? "review" : r.rulesYes ? "yes" : "no"; },
  "P2 model decides (abstain -> rules)": (r) => { const m = r.modelAll; if (abst(m)) return r.rulesYes ? "yes" : "no"; return m!.recruiting ? "yes" : "no"; },
  "P3 rules decide": (r) => (r.rulesYes ? "yes" : "no"),
  "P4 consensus; disagree -> model if certainty high else review": (r) => { const m = r.modelAll; if (abst(m)) return "review"; if (r.rulesYes === m!.recruiting) return r.rulesYes ? "yes" : "no"; return m!.certainty === "high" ? (m!.recruiting ? "yes" : "no") : "review"; },
  "P5 consensus; disagree -> rules if conf>=.8 else model": (r) => { const m = r.modelAll; if (abst(m)) return r.rulesYes ? "yes" : "no"; if (r.rulesYes === m!.recruiting) return r.rulesYes ? "yes" : "no"; return r.rulesConf >= 0.8 ? (r.rulesYes ? "yes" : "no") : (m!.recruiting ? "yes" : "no"); },
};
export function scorePolicy(rows: Row[], f: (r: Row) => Dec) {
  let tp = 0, fp = 0, fn = 0, tn = 0, revPos = 0, revNeg = 0;
  for (const r of rows) { const d = f(r); if (d === "review") { r.yes ? revPos++ : revNeg++; continue; } const p = d === "yes"; if (r.yes) p ? tp++ : fn++; else p ? fp++ : tn++; }
  const P = tp / (tp + fp || 1), R = tp / (tp + fn || 1);
  return { tp, fp, fn, tn, revPos, revNeg, P, R, F1: (2 * P * R) / (P + R || 1), strictR: tp / (tp + fn + revPos || 1), review: (revPos + revNeg) / rows.length, errors: fp + fn };
}

if (process.argv[2] === "policies") {
  const rows = await loadDev();
  const f = (x: number) => (100 * x).toFixed(1);
  for (const scope of [...DEV, "POOLED"]) {
    const rs = rows.filter((r) => scope === "POOLED" || r.ds === scope);
    console.log(`\n== ${scope} (n=${rs.length}, positives ${rs.filter((r) => r.yes).length})`);
    for (const [name, fn] of Object.entries(POLICIES)) { const s = scorePolicy(rs, fn); console.log(`${name.padEnd(62)} P ${f(s.P).padStart(5)} R ${f(s.R).padStart(5)} F1 ${s.F1.toFixed(3)}  strictR ${f(s.strictR).padStart(5)}  review ${f(s.review).padStart(4)}%  err ${s.errors}  (${s.tp}/${s.fp}/${s.fn}/${s.tn}, rev +${s.revPos}/-${s.revNeg})`); }
  }
  // disagreement anatomy under complete reads
  const dis = rows.filter((r) => !abst(r.modelAll) && r.rulesYes !== r.modelAll!.recruiting);
  console.log(`\nconfident disagreements (model reads all): ${dis.length}; rules right ${dis.filter((r) => r.rulesYes === r.yes).length}, model right ${dis.filter((r) => r.modelAll!.recruiting === r.yes).length}`);
  const tab: Record<string, [number, number]> = {};
  for (const r of dis) { const k = `model cert=${r.modelAll!.certainty} rules=${r.rulesYes ? "Y" : "n"} rulesConf>=.8:${r.rulesConf >= 0.8 ? "y" : "n"}`; tab[k] ??= [0, 0]; tab[k][r.modelAll!.recruiting === r.yes ? 0 : 1]++; }
  for (const [k, [m, ru]] of Object.entries(tab).sort()) console.log(`  ${k.padEnd(48)} model-right ${m}  rules-right ${ru}`);
  console.log(`model abstentions: ${rows.filter((r) => abst(r.modelAll)).length} (positives ${rows.filter((r) => abst(r.modelAll) && r.yes).length})`);
  process.exit(0);
}

// Metadata-only: Gmail system label ids for the DEVELOPMENT messages, from the development mailbox. No content is read.
if (process.argv[2] === "fetch-labels") {
  const { gmailConnections } = await import("../lib/db/schema.ts");
  const { getGmailRefreshToken } = await import("../lib/gmail/credentials.ts");
  const { refreshGmailAccessToken } = await import("../lib/gmail/oauth.ts");
  const { writePrivateFile, evalDir } = await import("../lib/eval-store/private-fs.ts");
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  // The development mailbox only. Never the BLIND mailbox (hash prefix f658bc).
  const subs = (await db.select({ s: gmailConnections.userGoogleSub }).from(gmailConnections).where(sql`left(md5(${gmailConnections.userGoogleSub}),6)='fe2f78'`)).map((x) => x.s);
  if (subs.length !== 1) throw new Error("expected exactly one development connection");
  const token = await refreshGmailAccessToken((await getGmailRefreshToken(subs[0]))!);
  const rows = await loadDev();
  const out: Record<string, string[] | null> = {};
  let done = 0, missing = 0;
  const file = `${evalDir()}/dev-gmail-labels.json`;
  const one = async (r: Row) => {
    for (let a = 1; a <= 6; a += 1) {
      try {
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${r.id}?format=minimal`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
        if (res.ok) { out[`${r.ds}|${r.id}`] = ((await res.json()) as { labelIds?: string[] }).labelIds ?? []; return; }
        if (res.status === 404) { out[`${r.ds}|${r.id}`] = null; missing += 1; return; }
      } catch { /* timeout or network error: retry */ }
      await new Promise((ok) => setTimeout(ok, 500 * a * a));
    }
    out[`${r.ds}|${r.id}`] = null; missing += 1;
  };
  for (let i = 0; i < rows.length; i += 3) { await Promise.all(rows.slice(i, i + 3).map(one)); done = i + 3; if (done % 150 === 0) { writePrivateFile(file, JSON.stringify(out)); console.log(`progress ${Object.keys(out).length}/${rows.length}`); } }
  writePrivateFile(`${evalDir()}/dev-gmail-labels.json`, JSON.stringify(out));
  console.log(`label ids fetched for ${Object.keys(out).length} dev messages (${missing} unavailable)`);
  process.exit(0);
}

if (process.argv[2] === "candidates") {
  const { readFileSync } = await import("node:fs");
  const labels: Record<string, string[] | null> = JSON.parse(readFileSync(`${process.env.HOME}/.opportunity-inbox/eval/dev-gmail-labels.json`, "utf8"));
  const rows = await loadDev();
  const L = (r: Row) => labels[`${r.ds}|${r.id}`] ?? [];
  // The production query (lib/gmail/recruiting-source.ts RECRUITING_QUERY), emulated: subject keyword OR ATS-ish sender. Gmail matches word tokens; stemming is ignored here.
  const SUBJ = /\b(application|applying|applied|interview|assessment|coding challenge|online assessment|offer|recruiter|candidacy|next steps|your candidacy|internship|phone screen|take-home)\b/i;
  const FROM = /(greenhouse\.io|greenhouse-mail\.io|lever\.co|myworkday\.com|ashbyhq\.com|icims\.com|smartrecruiters\.com|workable\.com|jobvite\.com|hackerrank\.com|codesignal\.com|codility\.com|hirevue\.com|karat\.com)/i;
  const query = (r: Row) => SUBJ.test(r.email.subject) || FROM.test(r.email.from);
  const cat = (r: Row) => L(r).find((x) => x.startsWith("CATEGORY_")) ?? "NO_CATEGORY";
  const pos = rows.filter((r) => r.yes);
  const dist = (rs: Row[]) => { const o: Record<string, number> = {}; for (const r of rs) bump(o, cat(r).replace("CATEGORY_", "")); return top(o, 8); };
  console.log(`category of positives (${pos.length}): ${dist(pos)}`);
  console.log(`category of negatives (${rows.length - pos.length}): ${dist(rows.filter((r) => !r.yes))}`);
  const defs: Array<[string, (r: Row) => boolean]> = [
    ["production query (emulated)", query],
    ["not promotions/social/forums", (r) => !["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(cat(r))],
    ["primary + updates only", (r) => ["CATEGORY_PERSONAL", "CATEGORY_UPDATES"].includes(cat(r))],
    ["primary only", (r) => cat(r) === "CATEGORY_PERSONAL"],
    ["not promotions/social/forums OR query", (r) => !["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(cat(r)) || query(r)],
  ];
  console.log("\ncandidate generation on dev (what would reach the readers)         volume          recall of positives");
  for (const [name, f] of defs) { const v = rows.filter(f); console.log(`${name.padEnd(46)} ${pct(v.length, rows.length).padEnd(18)} ${pct(pos.filter(f).length, pos.length)}`); }
  const miss = pos.filter((r) => !query(r)); console.log(`\npositives the production query would never fetch: ${miss.length}/${pos.length}; their categories: ${dist(miss)}`);
  const missCat = pos.filter((r) => ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(cat(r))); console.log(`positives Gmail files under promotions/social/forums: ${missCat.length}; senders: ${top(Object.fromEntries(missCat.map((r) => [r.domain, 1])))}`);
  const cap = rows.filter(query).length; console.log(`messages the query matches: ${cap} of ${rows.length} (${(cap / 10).toFixed(1)}% of mailbox); note production caps at 200 newest`);
  process.exit(0);
}

if (process.argv[2] === "triage-eval") {
  const { readFileSync } = await import("node:fs");
  const { triage } = await import("../lib/recruiting/reader/triage.ts");
  const labels: Record<string, string[] | null> = JSON.parse(readFileSync(`${process.env.HOME}/.opportunity-inbox/eval/dev-gmail-labels.json`, "utf8"));
  const rows = await loadDev();
  const cand = rows.filter((r) => { const c = (labels[`${r.ds}|${r.id}`] ?? []).find((x) => x.startsWith("CATEGORY_")); return !["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(c ?? ""); });
  const pass = cand.filter((r) => triage(r.email).pass);
  const reasons: Record<string, number> = {}; for (const r of cand) bump(reasons, triage(r.email).reason);
  console.log(`candidates (v2 query): ${cand.length}; after triage veto: ${pass.length} (${pct(pass.length, rows.length)} of mailbox read, vs G1 ${pct(rows.filter((r) => r.gateG1).length, rows.length)})`);
  console.log(`triage reasons: ${top(reasons, 8)}`);
  console.log(`positives surviving candidate+triage: ${pct(pass.filter((r) => r.yes).length, rows.filter((r) => r.yes).length)}`);
  const lost = rows.filter((r) => r.yes && !pass.includes(r)); console.log(`positives lost: ${lost.length}  (${lost.map((r) => r.domain).join(", ")})`);
  const modelFpAvoided = rows.filter((r) => !r.yes && modelYes(r.modelAll) && !pass.includes(r)).length; console.log(`model false positives removed by candidate+triage: ${modelFpAvoided} of ${rows.filter((r) => !r.yes && modelYes(r.modelAll)).length}`);
  process.exit(0);
}


// ---- stress set rows + export/import plumbing for the first-pass and adjudication reads ----
import { mkdirSync, readdirSync, readFileSync as rf } from "node:fs";
import { join as pj } from "node:path";
import { putCached } from "../lib/recruiting/reader/cache.ts";
import { GUIDE_V2, OUTPUT_SPEC } from "../lib/recruiting/reader/guide.ts";
import { triage } from "../lib/recruiting/reader/triage.ts";
import { verifyOutput } from "../lib/recruiting/reader/verify.ts";
import { toReaderType } from "../lib/recruiting/reader/taxonomy.ts";
import { writePrivateFile } from "../lib/eval-store/private-fs.ts";

export async function loadStress(): Promise<Row[]> {
  const { STRESS_SET, stressEmail } = await import("../lib/recruiting/reader/stress-set.ts");
  const emails = STRESS_SET.map(stressEmail);
  const preds = new Map(buildPredictions(emails).map((p) => [p.gmailMessageId, p]));
  const res = resolveBatch(emails.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, replyTo: e.replyTo, subject: e.subject, body: e.bodyText })));
  return STRESS_SET.map((c, i) => {
    const m = emails[i], p = preds.get(m.id), r = res.get(m.id);
    const names: string[] = [];
    for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name), ...(r?.evidence ?? []).filter((e) => e.weight >= 0.3).map((e) => e.name)]) if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
    const key = `m${sha(`stress:${m.id}`).slice(0, 8)}`;
    const input = buildReaderInput(m, key, names, 1, ["Sam"]);
    const rulesYes = p?.decision === "recruiting";
    return { ds: "stress", id: m.id, email: m, label: {}, yes: c.yes, rulesYes, rulesType: p?.type ?? null, candidates: names, threadMessages: 1, key, input, domain: domainOf(m.from), model: getCached(input, "A"), modelAll: getCached(input, "A"), gateG1: passGate("G1-process", m, rulesYes), rulesConf: p?.confidence ?? 0, rulesSignals: p?.signals ?? [], replied: false, threadMates: [m] } as Row;
  });
}

const rulesReading = (r: Row) => ({ recruiting: r.rulesYes, type: toReaderType(r.rulesType as never), company: null, role: null });


const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

if (process.argv[2] === "export-first-stress") {
  const out = arg("out")!; if (out.startsWith(process.cwd())) throw new Error("--out must be outside the repository");
  const rows = (await loadStress()).filter((r) => !r.modelAll);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writePrivateFile(pj(out, "batch-0.jsonl"), rows.map((r) => JSON.stringify(r.input)).join("\n") + "\n");
  writePrivateFile(pj(out, "map.json"), JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.id]))));
  writePrivateFile(pj(out, "guide.md"), `${GUIDE_V2}\n## Output format\n${OUTPUT_SPEC}\n`);
  console.log(`exported ${rows.length} stress messages for the first-pass model reader`);
  process.exit(0);
}
if (process.argv[2] === "import-first-stress") {
  const dir = arg("dir")!; const byKey = new Map((await loadStress()).map((r) => [r.key, r]));
  let ok = 0, bad = 0;
  for (const f of readdirSync(dir).filter((x) => /^out-\d+\.jsonl$/.test(x))) for (const line of rf(pj(dir, f), "utf8").split("\n").filter(Boolean)) {
    let raw: unknown; try { raw = JSON.parse(line); } catch { bad++; continue; }
    const row = byKey.get((raw as { key?: string })?.key ?? ""); if (!row) { bad++; continue; }
    const v = verifyOutput(raw, row.input); putCached(row.input, "A", v); v.status === "ok" ? ok++ : bad++;
  }
  console.log(`stress first-pass import: ${ok} ok, ${bad} invalid/unknown`);
  process.exit(0);
}

// ---- the comparison: frozen vs variants vs new architecture ----
if (process.argv[2] === "compare") {
  const labels: Record<string, string[] | null> = JSON.parse(rf(`${process.env.HOME}/.opportunity-inbox/eval/dev-gmail-labels.json`, "utf8"));
  const rows = await loadDev();
  const cat = (r: Row) => (labels[`${r.ds}|${r.id}`] ?? []).find((x) => x.startsWith("CATEGORY_")) ?? "";
  const SUBJ = /\b(application|applying|applied|interview|assessment|coding challenge|online assessment|offer|recruiter|candidacy|next steps|your candidacy|internship|phone screen|take-home)\b/i;
  const FROM = /(greenhouse\.io|greenhouse-mail\.io|lever\.co|myworkday\.com|ashbyhq\.com|icims\.com|smartrecruiters\.com|workable\.com|jobvite\.com|hackerrank\.com|codesignal\.com|codility\.com|hirevue\.com|karat\.com)/i;
  const inQuery = (r: Row) => SUBJ.test(r.email.subject) || FROM.test(r.email.from); // the frozen production query, emulated
  const inV2 = (r: Row) => !["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(cat(r)) && triage(r.email).pass;
  const dec = (state: string): Dec => (state === "recruiting" ? "yes" : state === "not_recruiting" ? "no" : "review");
  const rr = (r: Row) => rulesReading(r);
  const designs: Record<string, (r: Row) => Dec> = {
    "D1 frozen, reader level (all 1000; the pre-registered view)": (r) => dec(reconcile(rr(r), r.model).state),
    "D1e frozen end-to-end (production query -> G1 -> reconcile)": (r) => (inQuery(r) ? dec(reconcile(rr(r), r.model).state) : "no"),
    "D2 v2: category candidates + triage, read all, consensus/review": (r) => (inV2(r) ? dec(reconcile(rr(r), r.modelAll).state) : "no"),
  };
  const f = (x: number) => (100 * x).toFixed(1);
  for (const scope of [...DEV, "POOLED"]) {
    const rs = rows.filter((r) => scope === "POOLED" || r.ds === scope);
    console.log(`\n== ${scope} (n=${rs.length}, positives ${rs.filter((r) => r.yes).length})`);
    for (const [name, fn] of Object.entries(designs)) { const s = scorePolicy(rs, fn); console.log(`${name.padEnd(64)} P ${f(s.P).padStart(5)} R ${f(s.R).padStart(5)} F1 ${s.F1.toFixed(3)} strictR ${f(s.strictR).padStart(5)} review ${f(s.review).padStart(4)}% err ${String(s.errors).padStart(2)} (${s.tp}/${s.fp}/${s.fn}/${s.tn} +${s.revPos}/-${s.revNeg})`); }
  }
  console.log(`\nmodel reads: frozen G1 ${rows.filter((r) => r.gateG1).length}; v2 ${rows.filter(inV2).length} (of ${rows.length})`);
  process.exit(0);
}


if (process.argv[2] === "stress-compare") {
  const { STRESS_SET } = await import("../lib/recruiting/reader/stress-set.ts");
  const rows = await loadStress(); const cls = new Map(STRESS_SET.map((c) => [`stress-${c.id}`, c.cls]));
  const designs: Record<string, (r: Row) => Dec> = {
    "rules only": (r) => (r.rulesYes ? "yes" : "no"),
    "model only (reads everything)": (r) => (modelYes(r.modelAll) ? "yes" : "no"),
    "frozen: G1 gate + consensus/review": (r) => dec2(reconcile(rulesReading(r), r.model).state),
    "D2: read all + consensus/review": (r) => dec2(reconcile(rulesReading(r), r.modelAll).state),
  };
  function dec2(s: string): Dec { return s === "recruiting" ? "yes" : s === "not_recruiting" ? "no" : "review"; }
  const classes = ["program", "postoffer", "employed", "market", "core"];
  console.log(`class       n | ${Object.keys(designs).map((k) => k.slice(0, 22).padEnd(22)).join(" | ")}   (correct / wrong / review)`);
  for (const c of classes) {
    const rs = rows.filter((r) => cls.get(r.id) === c);
    const cell = (f: (r: Row) => Dec) => { let ok = 0, bad = 0, rv = 0; for (const r of rs) { const d = f(r); if (d === "review") rv++; else (d === "yes") === r.yes ? ok++ : bad++; } return `${ok}/${bad}/${rv}`.padEnd(22); };
    console.log(`${c.padEnd(10)} ${String(rs.length).padStart(2)} | ${Object.values(designs).map(cell).join(" | ")}`);
  }
  const all = (f: (r: Row) => Dec) => { let ok = 0, bad = 0, rv = 0; for (const r of rows) { const d = f(r); if (d === "review") rv++; else (d === "yes") === r.yes ? ok++ : bad++; } return `${ok}/${bad}/${rv}`.padEnd(22); };
  console.log(`ALL        ${rows.length} | ${Object.values(designs).map(all).join(" | ")}`);
  process.exit(0);
}

if (process.argv[2] === "paired") {
  const labels: Record<string, string[] | null> = JSON.parse(rf(`${process.env.HOME}/.opportunity-inbox/eval/dev-gmail-labels.json`, "utf8"));
  const rows = await loadDev();
  const cat = (r: Row) => (labels[`${r.ds}|${r.id}`] ?? []).find((x) => x.startsWith("CATEGORY_")) ?? "";
  const SUBJ = /\b(application|applying|applied|interview|assessment|coding challenge|online assessment|offer|recruiter|candidacy|next steps|your candidacy|internship|phone screen|take-home)\b/i;
  const FROM = /(greenhouse\.io|greenhouse-mail\.io|lever\.co|myworkday\.com|ashbyhq\.com|icims\.com|smartrecruiters\.com|workable\.com|jobvite\.com|hackerrank\.com|codesignal\.com|codility\.com|hirevue\.com|karat\.com)/i;
  const old = (r: Row): Dec => (SUBJ.test(r.email.subject) || FROM.test(r.email.from) ? (({ recruiting: "yes", not_recruiting: "no", review: "review" }) as Record<string, Dec>)[reconcile(rulesReading(r), r.model).state] : "no");
  const neu = (r: Row): Dec => { const plan = planReadLab(r); return plan ? (({ recruiting: "yes", not_recruiting: "no", review: "review" }) as Record<string, Dec>)[reconcile(rulesReading(r), r.modelAll).state] : "no"; };
  function planReadLab(r: Row) { return !["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(cat(r)) && triage(r.email).pass; }
  const wrong = (d: Dec, r: Row) => d !== "review" && (d === "yes") !== r.yes;
  let posNewOnly = 0, posOldOnly = 0, errNewOnly = 0, errOldOnly = 0;
  for (const r of rows) {
    const o = old(r), n = neu(r);
    if (r.yes) { if (n === "yes" && o !== "yes") posNewOnly++; if (o === "yes" && n !== "yes") posOldOnly++; }
    if (wrong(n, r) && !wrong(o, r)) errNewOnly++; if (wrong(o, r) && !wrong(n, r)) errOldOnly++;
  }
  console.log(`positives confidently found: only by NEW ${posNewOnly}, only by OLD ${posOldOnly}  (of 77)`);
  console.log(`wrong decisions: only NEW ${errNewOnly}, only OLD ${errOldOnly}`);
  const sign = (b: number, c: number) => { const n = b + c; let p = 0; for (let k = Math.max(b, c); k <= n; k++) { let lc = 0; for (let i = 1; i <= k; i++) lc += Math.log((n - i + 1) / i); p += Math.exp(lc - n * Math.log(2)); } return Math.min(1, 2 * p); };
  console.log(`exact sign test, positives found: p=${sign(posNewOnly, posOldOnly).toExponential(1)}; wrong decisions: p=${sign(errNewOnly, errOldOnly).toExponential(1)}`);
  process.exit(0);
}
