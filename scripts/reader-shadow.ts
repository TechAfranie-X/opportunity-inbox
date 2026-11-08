// Shadow-mode evaluation of the two-reader architecture. Development datasets only. Touches no product behavior.
//   npm run reader -- gate-report
//   npm run reader -- export --run A --gate G2-process-unbulk --out <dir outside the repo> --self-names a,b,c
//   (a worker reads <dir>/batch-N.jsonl + guide.md and writes <dir>/out-N.jsonl)
//   npm run reader -- import --run A --dir <dir> --self-names a,b,c
//   npm run reader -- report --run A [--run2 B] --gate G2-process-unbulk
// Model inputs are written only to the temporary --out dir (delete it afterwards); the cache stores verified outputs, never inputs.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { evalDatasets, labels as L } from "../lib/db/schema.ts";
import { latestLabels } from "../lib/eval-store/label-audit.ts";
import { ensurePrivateDir, writePrivateFile } from "../lib/eval-store/private-fs.ts";
import { readSnapshot } from "../lib/eval-store/snapshot.ts";
import { resolveBatch } from "../lib/recruiting/entity/resolve.ts";
import { buildPredictions } from "../lib/recruiting/predictions.ts";
import type { RecruitingEmail } from "../lib/recruiting/types.ts";
import { getCached, putCached } from "../lib/recruiting/reader/cache.ts";
import { passGate, type GateId } from "../lib/recruiting/reader/gate.ts";
import { GUIDE_V2, OUTPUT_SPEC, READER_VERSION, sha } from "../lib/recruiting/reader/guide.ts";
import { reconcile, sameOrg, type Reading } from "../lib/recruiting/reader/reconcile.ts";
import { buildReaderInput } from "../lib/recruiting/reader/redact.ts";
import { labelViewRole, labelViewType, toReaderType } from "../lib/recruiting/reader/taxonomy.ts";
import type { ReaderInput, VerifiedOutput } from "../lib/recruiting/reader/types.ts";
import { auditGrounding, verifyOutput } from "../lib/recruiting/reader/verify.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = new Map<string, string>();
for (let i = 1; i < argv.length; i += 1) if (argv[i].startsWith("--")) args.set(argv[i].slice(2), argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
const selfNames = (args.get("self-names") ?? process.env.READER_SELF_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const DATASETS = (args.get("datasets") ?? "dev-random-1,validation-1,validation-2").split(",").map((x) => x.trim()).filter(Boolean);
// Non-decisional sensitivity analyses only: message ids (one per line) removed from every metric.
const EXCL = new Set(args.get("exclude-ids") ? readFileSync(args.get("exclude-ids")!, "utf8").split("\n").map((x) => x.trim()).filter(Boolean) : []);
const GATES: GateId[] = ["G0-loose", "G1-process", "G2-process-unbulk"];

type Row = {
  ds: string; id: string; email: RecruitingEmail; label: Record<string, unknown>;
  rules: Reading; rulesYes: boolean; candidates: string[]; threadMessages: number; key: string;
};

async function load(): Promise<Row[]> {
  const db = getDb();
  const rows: Row[] = [];
  for (const name of DATASETS) {
    const [ds] = await db.select().from(evalDatasets).where(eq(evalDatasets.name, name));
    const lrows = await db.select().from(L).where(eq(L.datasetId, ds.id));
    const lab = latestLabels(lrows.map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field, value: r.value, createdAt: r.createdAt })));
    const { members, context } = readSnapshot(name);
    const all = [...members, ...context];
    const preds = new Map(buildPredictions(all).map((p) => [p.gmailMessageId, p]));
    const res = resolveBatch(all.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, replyTo: e.replyTo, subject: e.subject, body: e.bodyText })));
    const perThread = new Map<string, number>();
    for (const m of all) perThread.set(m.threadId, (perThread.get(m.threadId) ?? 0) + 1);
    for (const m of members) {
      const p = preds.get(m.id);
      const r = res.get(m.id);
      const names: string[] = [];
      for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name), ...(r?.evidence ?? []).filter((e) => e.weight >= 0.3).map((e) => e.name)]) if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
      const rulesYes = p?.decision === "recruiting";
      rows.push({
        ds: name, id: m.id, email: m, label: lab.get(m.id) ?? {}, rulesYes, candidates: names,
        rules: { recruiting: rulesYes, type: toReaderType(p?.type ?? null), company: p?.company ?? null, role: p?.role ?? null },
        threadMessages: perThread.get(m.threadId) ?? 1, key: `m${sha(`${name}:${m.id}`).slice(0, 8)}`,
      });
    }
  }
  return rows;
}

const input = (r: Row): ReaderInput => buildReaderInput(r.email, r.key, r.candidates, r.threadMessages, selfNames);
const wil = (k: number, n: number) => {
  if (!n) return "n/a";
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return `${(100 * p).toFixed(1)}% [${((100 * (c - m)) / d).toFixed(0)}-${((100 * (c + m)) / d).toFixed(0)}] (${k}/${n})`;
};
const isYes = (r: Row) => r.label.is_recruiting === true;
const f1 = (tp: number, fp: number, fn: number) => { const p = tp / (tp + fp || 1), rc = tp / (tp + fn || 1); return `P ${(100 * p).toFixed(1)} R ${(100 * rc).toFixed(1)} F1 ${((2 * p * rc) / (p + rc || 1)).toFixed(3)}  TP/FP/FN/TN`; };

const rows = (await load()).filter((r) => !EXCL.has(r.id));

if (cmd === "gate-report") {
  console.log(`gate report · ${rows.length} messages · ${rows.filter(isYes).length} labeled recruiting (development data: gate choices below are fitted to it)`);
  for (const g of GATES) {
    for (const scope of [...DATASETS, "ALL"]) {
      const rs = rows.filter((r) => scope === "ALL" || r.ds === scope);
      const pass = rs.filter((r) => passGate(g, r.email, r.rulesYes));
      const pos = rs.filter(isYes);
      const caught = pos.filter((r) => passGate(g, r.email, r.rulesYes));
      const noRules = pos.filter((r) => passGate(g, r.email, false)).length; // recall WITHOUT the "rules said yes" shortcut
      console.log(`${g.padEnd(18)} ${scope.padEnd(13)} coverage ${wil(pass.length, rs.length)}  recall ${wil(caught.length, pos.length)}  recall-without-rules-shortcut ${noRules}/${pos.length}`);
    }
  }
  process.exit(0);
}

if (cmd === "export") {
  const run = args.get("run") ?? "A";
  const gate = (args.get("gate") ?? "G2-process-unbulk") as GateId;
  const out = args.get("out") ?? (console.error("--out required"), process.exit(1));
  if (out.startsWith(process.cwd())) { console.error("--out must be outside the repository"); process.exit(1); }
  const per = Number(args.get("batch") ?? 60);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const todo = rows.filter((r) => passGate(gate, r.email, r.rulesYes)).map((r) => ({ r, i: input(r) })).filter(({ i }) => !getCached(i, run));
  const batches = Math.ceil(todo.length / per);
  const map: Record<string, { ds: string; id: string }> = {};
  for (let b = 0; b < batches; b += 1) {
    const slice = todo.slice(b * per, (b + 1) * per);
    slice.forEach(({ r }) => (map[r.key] = { ds: r.ds, id: r.id }));
    writePrivateFile(join(out, `batch-${b}.jsonl`), slice.map(({ i }) => JSON.stringify(i)).join("\n") + "\n");
  }
  writePrivateFile(join(out, "map.json"), JSON.stringify(map));
  writePrivateFile(join(out, "guide.md"), `${GUIDE_V2}\n## Output format\n${OUTPUT_SPEC}\n`);
  console.log(`exported run ${run} (${READER_VERSION}, gate ${gate}): ${todo.length} messages to read in ${batches} batches of <= ${per}, ${rows.filter((r) => passGate(gate, r.email, r.rulesYes)).length - todo.length} already cached`);
  console.log(`approx input characters: ${todo.reduce((n, { i }) => n + JSON.stringify(i).length, 0)}`);
  process.exit(0);
}

if (cmd === "import") {
  const run = args.get("run") ?? "A";
  const dir = args.get("dir") ?? (console.error("--dir required"), process.exit(1));
  const map: Record<string, { ds: string; id: string }> = JSON.parse(readFileSync(join(dir, "map.json"), "utf8"));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  ensurePrivateDir(join(dir));
  const seen = new Set<string>();
  const stats = { lines: 0, parsed: 0, notJson: 0, unknownKey: 0, ok: 0, invalid: 0, unsupportedYes: 0 };
  const rejections: Record<string, number> = {};
  for (const f of readdirSync(dir).filter((x) => /^out-\d+\.jsonl$/.test(x))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
      stats.lines += 1;
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { stats.notJson += 1; continue; }
      const key = (raw as { key?: string })?.key;
      const row = key ? byKey.get(key) : undefined;
      if (!row || !map[row.key]) { stats.unknownKey += 1; continue; }
      stats.parsed += 1;
      const inp = input(row);
      const v = verifyOutput(raw, inp);
      seen.add(row.key);
      if (v.status === "ok") stats.ok += 1; else if (v.status === "invalid") stats.invalid += 1; else stats.unsupportedYes += 1;
      for (const x of v.rejections) rejections[x] = (rejections[x] ?? 0) + 1;
      putCached(inp, run, v);
    }
  }
  const missing = Object.keys(map).filter((k) => !seen.has(k)).length;
  console.log(`import run ${run}: ${JSON.stringify(stats)} · expected ${Object.keys(map).length}, missing ${missing}`);
  console.log(`verification rejections: ${JSON.stringify(rejections)}`);
  process.exit(0);
}

if (cmd === "report") {
  const runA = args.get("run") ?? "A";
  const runB = args.get("run2");
  const gate = (args.get("gate") ?? "G2-process-unbulk") as GateId;
  const get = (r: Row, run: string): VerifiedOutput | null => (passGate(gate, r.email, r.rulesYes) ? getCached(input(r), run) : null);
  const modelReading = (m: VerifiedOutput | null): Reading => ({ recruiting: !!m && m.status === "ok" && m.recruiting, type: m?.type ?? null, company: m?.company ?? null, role: m?.role ?? null });
  const missing = rows.filter((r) => passGate(gate, r.email, r.rulesYes) && !getCached(input(r), runA)).length;
  console.log(`two-reader shadow report · reader ${READER_VERSION} · gate ${gate} · run ${runA}${runB ? ` (+${runB})` : ""} · ${rows.length} messages, ${rows.filter(isYes).length} labeled recruiting · gated messages without a model output: ${missing}`);
  console.log("development data only; the guide was locked before the first scored run; labels are read through the guide-v2 view (stored labels unchanged)");

  type Acc = Record<string, number>;
  const score = (rs: Row[], who: "rules" | "model" | "recon", run: string) => {
    const a: Acc = {};
    const bump = (k: string, v = 1) => (a[k] = (a[k] ?? 0) + v);
    for (const r of rs) {
      const m = get(r, run);
      const rec = reconcile(r.rules, m);
      const reading: Reading = who === "rules" ? r.rules : who === "model" ? modelReading(m) : { recruiting: rec.state === "recruiting", type: rec.type, company: rec.company, role: rec.role };
      const y = isYes(r);
      const inReview = who === "recon" && rec.state === "review";
      if (!inReview) bump(`${y ? (reading.recruiting ? "TP" : "FN") : reading.recruiting ? "FP" : "TN"}`);
      else bump(y ? "revPos" : "revNeg");
      if (!y) continue;
      const lt = labelViewType(r.label.type, r.label.stage);
      const typeShown = who === "recon" ? rec.type : reading.recruiting ? reading.type : null;
      if (lt && lt !== "unknown" && lt !== "not_applicable") { bump("type_n"); if (typeShown === lt) bump("type_ok"); }
      const lc = r.label.company;
      const compShown = who === "recon" ? rec.company : reading.recruiting ? reading.company : null;
      if (typeof lc === "string" && lc !== "unknown" && lc !== "not_applicable") { bump("co_n"); if (compShown && compShown.trim().toLowerCase() === lc.trim().toLowerCase()) bump("co_exact"); if (compShown && sameOrg(compShown, lc)) bump("co_ok"); if (compShown && !sameOrg(compShown, lc)) bump("co_wrong"); if (!compShown) bump("co_abstain"); }
      const lr = labelViewRole(r.label.role);
      const roleShown = who === "recon" ? rec.role : reading.recruiting ? reading.role : null;
      if (lr !== "unknown") { bump("role_n"); if (lr === "not_applicable" ? !roleShown : !!roleShown && sameOrg(roleShown, lr)) bump("role_ok"); }
    }
    return a;
  };
  const line = (tag: string, a: Acc) =>
    `${tag.padEnd(12)} ${f1(a.TP ?? 0, a.FP ?? 0, a.FN ?? 0)} ${a.TP ?? 0}/${a.FP ?? 0}/${a.FN ?? 0}/${a.TN ?? 0}${a.revPos || a.revNeg ? `  (review: ${a.revPos ?? 0} labeled-Yes, ${a.revNeg ?? 0} labeled-No)` : ""}`;
  const fields = (a: Acc) => `type ${wil(a.type_ok ?? 0, a.type_n ?? 0)} · company ${wil(a.co_ok ?? 0, a.co_n ?? 0)} (wrong ${a.co_wrong ?? 0}, none ${a.co_abstain ?? 0}) · role ${wil(a.role_ok ?? 0, a.role_n ?? 0)}`;

  for (const scope of [...DATASETS, "POOLED"]) {
    const rs = rows.filter((r) => scope === "POOLED" || r.ds === scope);
    console.log(`\n== ${scope} (n=${rs.length}, recruiting ${rs.filter(isYes).length})`);
    for (const [tag, who] of [["rules-only", "rules"], ["model-only", "model"], ["reconciled", "recon"]] as const) {
      const a = score(rs, who, runA);
      console.log(line(tag, a));
      console.log(`             ${fields(a)}`);
    }
  }

  // Agreement / disagreement (pooled, over every message; messages the gate never sent count as model "no")
  let agree = 0, agreeWrong = 0, review = 0, reviewRulesWrong = 0, reviewModelWrong = 0, reviewPos = 0, modelAbstain = 0;
  let typeAgree = 0, typeAgreeOk = 0, typeDis = 0, typeDisOk = 0, flagsCompany = 0, flagsRole = 0, flagsType = 0, agreedRecruiting = 0;
  for (const r of rows) {
    const m = get(r, runA);
    const rec = reconcile(r.rules, m);
    const y = isYes(r);
    if (rec.state === "review") {
      review += 1; if (y) reviewPos += 1;
      if (r.rules.recruiting !== y) reviewRulesWrong += 1;
      if (modelReading(m).recruiting !== y) reviewModelWrong += 1;
      if (rec.reason === "model_abstained") modelAbstain += 1;
    } else {
      agree += 1; if ((rec.state === "recruiting") !== y) agreeWrong += 1;
      if (rec.state === "recruiting") {
        agreedRecruiting += 1; if (rec.typeReview) flagsType += 1; if (rec.companyReview) flagsCompany += 1; if (rec.roleReview) flagsRole += 1;
        const lt = labelViewType(r.label.type, r.label.stage);
        if (y && lt && lt !== "unknown" && lt !== "not_applicable") { if (rec.typeReview) { typeDis += 1; if (rec.type === lt) typeDisOk += 1; } else { typeAgree += 1; if (rec.type === lt) typeAgreeOk += 1; } }
      }
    }
  }
  console.log(`\n== Reader agreement (pooled, ${rows.length} messages)`);
  console.log(`agree (confident)      ${wil(agree, rows.length)}   errors when readers agree ${wil(agreeWrong, agree)}`);
  console.log(`disagree / abstain     ${wil(review, rows.length)}   (of which model abstained or unverifiable: ${modelAbstain}; labeled-Yes inside review: ${reviewPos})`);
  console.log(`inside review: rules wrong ${reviewRulesWrong}/${review}, model wrong ${reviewModelWrong}/${review}  ->  error rate when readers disagree (taking the rules) ${wil(reviewRulesWrong, review)}`);
  const rulesErrors = rows.filter((r) => r.rules.recruiting !== isYes(r)).length;
  const caught = rows.filter((r) => r.rules.recruiting !== isYes(r) && reconcile(r.rules, get(r, runA)).state === "review").length;
  console.log(`rules recruiting errors caught by review: ${caught}/${rulesErrors}`);
  console.log(`field flags among ${agreedRecruiting} agreed-recruiting messages: type ${flagsType}, company ${flagsCompany}, role ${flagsRole}`);
  console.log(`type accuracy when types agree ${wil(typeAgreeOk, typeAgree)}; when flagged ${wil(typeDisOk, typeDis)}`);

  // Verification and grounding
  const st: Record<string, number> = {}; const rj: Record<string, number> = {}; let survivors = 0; let outputs = 0; const srcs: Record<string, number> = {};
  for (const r of rows) {
    if (!passGate(gate, r.email, r.rulesYes)) continue;
    const inp = input(r); const m = getCached(inp, runA);
    if (!m) continue;
    outputs += 1; st[m.status] = (st[m.status] ?? 0) + 1;
    for (const x of m.rejections) rj[x] = (rj[x] ?? 0) + 1;
    survivors += auditGrounding(m, inp).length;
    if (m.companySource) srcs[m.companySource] = (srcs[m.companySource] ?? 0) + 1;
  }
  console.log(`\n== Verification (${outputs} model outputs)`);
  console.log(`status ${JSON.stringify(st)}; field rejections ${JSON.stringify(rj)}; company sources ${JSON.stringify(srcs)}`);
  console.log(`ungrounded structured values surviving verification (independent re-audit): ${survivors}`);

  // Candidate recall for company
  let candN = 0, candOk = 0;
  for (const r of rows) if (isYes(r) && typeof r.label.company === "string" && r.label.company !== "unknown" && r.label.company !== "not_applicable") { candN += 1; if (r.candidates.some((c) => sameOrg(c, String(r.label.company)))) candOk += 1; }
  console.log(`resolver candidate recall for the labeled employer: ${wil(candOk, candN)}`);

  // Gate
  const pos = rows.filter(isYes); const pass = rows.filter((r) => passGate(gate, r.email, r.rulesYes));
  console.log(`\n== Gate ${gate}: coverage ${wil(pass.length, rows.length)}; recruiting recall ${wil(pos.filter((r) => passGate(gate, r.email, r.rulesYes)).length, pos.length)}`);

  // Determinism
  if (runB) {
    let both = 0, decDiff = 0, bothYes = 0, typeDiff = 0, coDiff = 0, roleDiff = 0, certDiff = 0, statusDiff = 0;
    for (const r of rows) {
      if (!passGate(gate, r.email, r.rulesYes)) continue;
      const a = getCached(input(r), runA), b = getCached(input(r), runB);
      if (!a || !b) continue;
      both += 1;
      const ay = a.status === "ok" && a.recruiting, by = b.status === "ok" && b.recruiting;
      if (ay !== by) decDiff += 1;
      if (a.status !== b.status) statusDiff += 1;
      if (a.certainty !== b.certainty) certDiff += 1;
      if (ay && by) { bothYes += 1; if (a.type !== b.type) typeDiff += 1; if (!!a.company !== !!b.company || (a.company && b.company && !sameOrg(a.company, b.company))) coDiff += 1; if ((a.role ?? "") !== (b.role ?? "")) roleDiff += 1; }
    }
    console.log(`\n== Run-to-run (${runA} vs ${runB}) over ${both} messages read twice`);
    console.log(`recruiting decision differs ${wil(decDiff, both)} of gated; ${wil(decDiff, rows.length)} of all messages; status differs ${statusDiff}; certainty differs ${certDiff}`);
    console.log(`among ${bothYes} both-yes: type differs ${typeDiff}, company differs ${coDiff}, role differs ${roleDiff}`);
    // reconciled stability
    let recDiff = 0;
    for (const r of rows) { const a = reconcile(r.rules, get(r, runA)).state, b = reconcile(r.rules, get(r, runB)).state; if (a !== b) recDiff += 1; }
    console.log(`reconciled state (recruiting / not_recruiting / review) differs for ${wil(recDiff, rows.length)} of all messages`);
  }

  if (args.get("bars") === "true") {
    // Pass-bar table for the reconciled (confident-region) result, with intervals. Definitions are the report's own, unchanged.
    const a = score(rows, "recon", runA);
    const tp = a.TP ?? 0, fp = a.FP ?? 0, fn = a.FN ?? 0, tn = a.TN ?? 0, revPos = a.revPos ?? 0, revNeg = a.revNeg ?? 0;
    const prec = tp / (tp + fp || 1), rec = tp / (tp + fn || 1), f1v = (2 * prec * rec) / (prec + rec || 1);
    // Percentile bootstrap over messages for F1 (fixed seed), because the positives are few and Wilson has no F1 form.
    let st = 20261108; const rnd = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const cls = rows.map((r) => { const rc = reconcile(r.rules, get(r, runA)); return rc.state === "review" ? 0 : (rc.state === "recruiting") === isYes(r) ? (isYes(r) ? 1 : 0) : isYes(r) ? 3 : 2; }); // 1 TP, 2 FP, 3 FN
    const f1s: number[] = [];
    for (let b = 0; b < 2000; b += 1) { let T = 0, F = 0, N = 0; for (let i = 0; i < cls.length; i += 1) { const c = cls[Math.floor(rnd() * cls.length)]; if (c === 1) T += 1; else if (c === 2) F += 1; else if (c === 3) N += 1; } f1s.push((2 * T) / (2 * T + F + N || 1)); }
    f1s.sort((x, y) => x - y);
    const ci = (k: number, n: number) => { if (!n) return [NaN, NaN]; const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
    const pct = (x: number) => (Number.isFinite(x) ? (100 * x).toFixed(1) : "n/a");
    const ver = (v: number, bar: number, upper = false) => (upper ? v <= bar : v >= bar) ? "PASS" : "FAIL";
    const row = (label: string, k: number, n: number, bar: number, upper = false) => { const [lo, hi] = ci(k, n); const v = n ? k / n : NaN; const barOk = n ? ver(v, bar, upper) : "n/a"; const clear = n ? (upper ? hi <= bar : lo >= bar) : false; return `${label.padEnd(34)} ${pct(v).padStart(6)}%  [${pct(lo)}-${pct(hi)}]  (${k}/${n})  bar ${upper ? "<=" : ">="} ${pct(bar)}%  point: ${barOk}  interval clears bar: ${clear ? "yes" : "NO"}`; };
    console.log(`\n== PASS-BAR TABLE (reconciled, confident region; ${rows.length} messages, ${rows.filter(isYes).length} labeled recruiting; Wilson 95%)`);
    console.log(`reconciled TP/FP/FN/TN ${tp}/${fp}/${fn}/${tn}; in review: ${revPos} labeled-Yes, ${revNeg} labeled-No`);
    console.log(row("1 recruiting precision", tp, tp + fp, 0.8));
    console.log(row("2 recruiting recall", tp, tp + fn, 0.8));
    console.log(`${"3 recruiting F1".padEnd(34)} ${pct(f1v).padStart(6)}   [${pct(f1s[Math.floor(0.025 * f1s.length)])}-${pct(f1s[Math.floor(0.975 * f1s.length)])}] (bootstrap)  bar >= 85.0  point: ${f1v >= 0.85 ? "PASS" : "FAIL"}  interval clears bar: ${f1s[Math.floor(0.025 * f1s.length)] >= 0.85 ? "yes" : "NO"}`);
    console.log(row("4 event-type accuracy", a.type_ok ?? 0, a.type_n ?? 0, 0.8));
    console.log(row("5 company normalized accuracy", a.co_ok ?? 0, a.co_n ?? 0, 0.8));
    console.log(row("6 role accuracy", a.role_ok ?? 0, a.role_n ?? 0, 0.7));
    console.log(row("7 error when readers agree", agreeWrong, agree, 0.02, true));
    console.log(row("8 review / disagreement rate", review, rows.length, 0.08, true));
    console.log(`${"9 ungrounded values surviving".padEnd(34)} ${String(survivors).padStart(6)}   bar = 0  point: ${survivors === 0 ? "PASS" : "FAIL"}`);
    console.log(`context (not a bar): company EXACT (case-insensitive string equality) ${a.co_exact ?? 0}/${a.co_n ?? 0}; company wrong ${a.co_wrong ?? 0}, abstained ${a.co_abstain ?? 0}`);
    console.log(`context (not a bar): recall counting review-routed labeled-Yes as misses = ${tp}/${tp + fn + revPos} (${pct(tp / (tp + fn + revPos || 1))}%); review-routed labeled-Yes: ${revPos}`);
  }
  process.exit(0);
}

console.error("usage: gate-report | export | import | report");
process.exit(1);
