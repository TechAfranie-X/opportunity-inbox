// Prospective-evaluation tooling for architecture v2 (docs/prospective-evaluation-protocol.md). Invoked through
// `npm run shadow -- <command>`:
//   status                          counts only; never prints accuracy, agreement or disagreement
//   label-set  --user X [--week 2026w49] [--dry-run]   build weekly label datasets from INGESTION FACTS ONLY
//   analyze    [--through ISO]      THE single analysis (refuses until every precondition holds; runs once)
//   synthetic-run                   the whole workflow on fixtures; consumes no real evidence
//   power                           the power analysis behind the minimum evidence
//   freeze-check                    mechanical preconditions for creating the freeze tag
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { evalDatasetItems, evalDatasets, labels as labelsTable } from "../lib/db/schema.ts";
import { latestLabels } from "../lib/eval-store/label-audit.ts";
import { evalDir, writePrivateFile } from "../lib/eval-store/private-fs.ts";
import { freezeLocal, manifestHash, readManifest, writeSnapshot, type Manifest } from "../lib/eval-store/snapshot.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById, fetchThreadMessages } from "../lib/gmail/recruiting-source.ts";
import { READER_VERSION_V3 } from "../lib/recruiting/reader/guide3.ts";
import { EXTRACTOR_VERSION } from "../lib/recruiting/version.ts";
import { computeAnalysis, formatAnalysis, type AnalysisRow, type Population } from "../lib/recruiting/shadow/analysis.ts";
import { missingFromProtocol } from "../lib/recruiting/shadow/consistency.ts";
import { FROZEN } from "../lib/recruiting/shadow/frozen.ts";
import { labelFactsFrom, toAnalysisRow } from "../lib/recruiting/shadow/join.ts";
import { INGESTION_COLUMNS, isoWeek, selectLabelSet, type Selected } from "../lib/recruiting/shadow/labelset.ts";
import { PLANNING, feasibility, powerAtLeast, powerAtMost, minimumN, requirements } from "../lib/recruiting/shadow/power.ts";
import { PIPELINE_VERSION } from "../lib/recruiting/shadow/shadow.ts";
import { effectiveSize } from "../lib/recruiting/shadow/stats.ts";
import { assertAllReal, assertAllSynthetic, ingestionFactsOf, runSyntheticPipeline, type SyntheticParams } from "../lib/recruiting/shadow/synthetic.ts";
import { allRecords, ingestionFacts } from "../lib/recruiting/shadow/store.ts";

/**
 * Rehearsal hook. When (and only when) DATABASE_URL names a database starting with "scratch_", the clock may be overridden
 * and the freeze-tag comparison is skipped, so the whole analysis path can be rehearsed against a throwaway database without
 * waiting for real evidence. Against the real database neither override exists. A result produced this way says so loudly.
 */
const SCRATCH = (() => { try { return new URL(process.env.DATABASE_URL ?? "").pathname.slice(1).startsWith("scratch_"); } catch { return false; } })();
const clock = () => (SCRATCH && process.env.PROSPECTIVE_NOW ? new Date(process.env.PROSPECTIVE_NOW) : new Date());

type Helpers = { resolveUser: (v: string) => Promise<string>; label: (sub: string) => string };
const fail = (m: string): never => { console.error(`error: ${m}`); process.exit(1); };
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (...a: string[]) => { try { return git(...a); } catch { return null; } };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const DAY = 86400000;
const pad = (s: string, n: number) => s.padEnd(n);

export async function run(cmd: string, args: Map<string, string>, h: Helpers) {
  if (cmd === "status") return status(h);
  if (cmd === "label-set") return labelSet(args, h);
  if (cmd === "analyze") return analyze(args);
  if (cmd === "synthetic-run") return syntheticRun();
  if (cmd === "power") return power();
  if (cmd === "freeze-check") return freezeCheck();
}

// ------------------------------------------------------------------ status
async function labelsByMessage() {
  const db = getDb();
  const sets = await db.select().from(evalDatasets).where(like(evalDatasets.name, `${FROZEN.datasetPrefix}%`));
  if (sets.length === 0) return { sets, labels: new Map<string, Record<string, unknown>>() };
  const rows = (await db.select().from(labelsTable).where(inArray(labelsTable.datasetId, sets.map((s) => s.id)))).filter((r) => r.source === "blind_human");
  const labels = latestLabels(rows.map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field, value: r.value, createdAt: r.createdAt })));
  return { sets, labels };
}

async function status(h: Helpers) {
  const now = new Date(), cutoff = new Date(FROZEN.cutoff);
  console.log(`prospective-1 · now ${now.toISOString()} · cutoff ${FROZEN.cutoff} (${((cutoff.getTime() - now.getTime()) / DAY).toFixed(1)} days ${cutoff > now ? "away" : "ago"}) · hard stop ${FROZEN.hardStop}`);
  const facts = await ingestionFacts(null);
  const selected = selectLabelSet(facts);
  const bySub = new Map<string, number>();
  for (const f of facts) bySub.set(f.userGoogleSub, (bySub.get(f.userGoogleSub) ?? 0) + 1);
  const recs = await allRecords(null); // counts below use only routing/read-status, never a decision
  for (const [sub, n] of bySub) {
    const mine = recs.filter((r) => r.userGoogleSub === sub);
    console.log(`mailbox ${h.label(sub)}: ${n} rows · historical ${mine.filter((r) => r.cohort === "historical").length} · prospective ${mine.filter((r) => r.cohort === "prospective").length} · planned reads pending ${mine.filter((r) => r.plannedRead && r.modelStatus === null).length}`);
  }
  console.log(`label set so far: S1 ${selected.filter((s) => s.stratum === "S1").length} · S2 ${selected.filter((s) => s.stratum === "S2").length}`);
  const { sets, labels } = await labelsByMessage();
  const done = selected.filter((s) => labelFactsFrom(labels.get(s.gmailMessageId)));
  console.log(`label datasets ${sets.length} · selected messages labeled ${done.length} of ${selected.length}`);
  const pos = done.filter((s) => labelFactsFrom(labels.get(s.gmailMessageId))!.positive);
  const units = pos.map((s) => ({ w: s.weight, s: 1, c: `${s.userGoogleSub}|${s.gmailThreadId}` }));
  console.log(`label-only evidence progress: labeled positives ${pos.length} (thread-level effective n ${effectiveSize(units).toFixed(1)} before opportunity clustering; required ${FROZEN.minimumEvidence.recallPositives} effective)`);
  console.log("(counts only: no accuracy, agreement or disagreement figure is available before the single analysis)");
}

// ------------------------------------------------------------------ label-set
async function labelSet(args: Map<string, string>, h: Helpers) {
  const sub = await h.resolveUser(args.get("user") ?? fail("missing --user"));
  const dry = args.get("dry-run") === "true";
  const onlyWeek = args.get("week");
  const selected = selectLabelSet(await ingestionFacts(sub)); // ingestion columns only: no reader output is ever loaded here
  const db = getDb();
  const existing = await db.select({ id: evalDatasetItems.gmailMessageId, name: evalDatasets.name }).from(evalDatasetItems).innerJoin(evalDatasets, eq(evalDatasets.id, evalDatasetItems.datasetId)).where(like(evalDatasets.name, `${FROZEN.datasetPrefix}%`));
  const done = new Set(existing.map((e) => e.id));
  const fresh = selected.filter((s) => !done.has(s.gmailMessageId));
  const weeks = new Map<string, Selected[]>();
  for (const s of fresh) { const w = isoWeek(s.arrivedAt); if (!onlyWeek || w === onlyWeek) weeks.set(w, [...(weeks.get(w) ?? []), s]); }
  if (weeks.size === 0) return console.log(`mailbox ${h.label(sub)}: nothing new to put in a label set (selected ${selected.length}, already in datasets ${selected.length - fresh.length}).`);
  for (const [w, items] of [...weeks].sort()) console.log(`${w}: ${items.length} messages (S1 ${items.filter((i) => i.stratum === "S1").length}, S2 ${items.filter((i) => i.stratum === "S2").length})`);
  if (dry) return console.log("DRY RUN: no dataset was created and no message was fetched.");

  const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub)) ?? fail("no connection"));
  for (const [w, items] of [...weeks].sort()) {
    const base = `${FROZEN.datasetPrefix}${h.label(sub)}-${w}`;
    const taken = new Set((await db.select({ n: evalDatasets.name }).from(evalDatasets).where(like(evalDatasets.name, `${base}%`))).map((r) => r.n));
    let name = base, k = 0;
    while (taken.has(name)) { k += 1; name = `${base}-${String.fromCharCode(97 + k)}`; }
    const ids = items.map((i) => i.gmailMessageId);
    const { emails, missing } = await fetchEmailsById(token, ids);
    const members = emails.filter((e) => !e.outbound);
    const context = (await fetchThreadMessages(token, members.map((m) => m.threadId))).filter((e) => !ids.includes(e.id));
    const manifest: Manifest = {
      name, kind: "blind", createdAt: new Date().toISOString(), frozenAt: null, manifestHash: null, asOf: new Date().toISOString().slice(0, 16) + ":00.000Z",
      account: `prospective-1:${h.label(sub)}`, memberIds: ids, contextIds: [...new Set(context.map((c) => c.id))],
      missing: ids.filter((id) => !members.some((m) => m.id === id)).concat(missing),
      sampling: { method: "random", seed: FROZEN.armHash, universeSize: items.length, universeQuery: "shadow label set: S1 census + S2 sampling arm (ingestion facts only)", universeHash: manifestHash(ids) },
    };
    writeSnapshot(manifest, members, context);
    const [row] = await db.insert(evalDatasets).values({ name, kind: "blind", note: `account=${manifest.account}` }).returning();
    const threadOf = new Map(items.map((i) => [i.gmailMessageId, i.gmailThreadId]));
    for (let i = 0; i < ids.length; i += 500) await db.insert(evalDatasetItems).values(ids.slice(i, i + 500).map((id) => ({ datasetId: row.id, gmailMessageId: id, gmailThreadId: threadOf.get(id) ?? "" })));
    const frozen = freezeLocal(name);
    await db.update(evalDatasets).set({ frozenAt: new Date(frozen.frozenAt!), manifestHash: frozen.manifestHash }).where(eq(evalDatasets.id, row.id));
    console.log(`${name}: ${members.length} fetched, ${manifest.missing.length} unfetchable (disclosed, dropped at analysis), ${manifest.contextIds.length} thread-context messages. FROZEN ${frozen.manifestHash!.slice(0, 12)}.`);
    console.log(`  label it: npm run eval:label -- --dataset ${name}`);
  }
}

// ------------------------------------------------------------------ analyze
async function analyze(args: Map<string, string>) {
  const now = clock();
  const through = new Date(Math.min(args.get("through") ? new Date(args.get("through")!).getTime() : Infinity, new Date(FROZEN.eligibleThrough).getTime(), now.getTime() - FROZEN.labelWithinDays * DAY));
  const refusals: string[] = [];
  const cutoff = new Date(FROZEN.cutoff);
  const weeksSince = (now.getTime() - cutoff.getTime()) / (7 * DAY);
  const hardStopReached = now >= new Date(FROZEN.hardStop);

  // 1. the code under test is the frozen code
  const tagTree = tryGit("rev-parse", `${FROZEN.freezeTag}:lib/recruiting`), headTree = tryGit("rev-parse", "HEAD:lib/recruiting");
  const tagOpp = tryGit("rev-parse", `${FROZEN.freezeTag}:lib/opportunities`), headOpp = tryGit("rev-parse", "HEAD:lib/opportunities");
  if (!SCRATCH) {
    if (!tagTree) refusals.push(`freeze tag ${FROZEN.freezeTag} does not exist`);
    else if (tagTree !== headTree || tagOpp !== headOpp) refusals.push("lib/recruiting or lib/opportunities differs from the freeze tag: the candidate was modified");
    if (tryGit("status", "--porcelain", "--", "lib", "scripts")) refusals.push("uncommitted changes in lib/ or scripts/");
  }
  // 2. the analysis runs once
  const resultFile = join(evalDir(), "prospective-1.RESULT.txt");
  if (existsSync(resultFile)) refusals.push(`a result already exists (${resultFile}); the analysis runs once`);
  // 3. time gate
  if (!hardStopReached && weeksSince < FROZEN.minWeeksAfterCutoff) refusals.push(`too early: ${weeksSince.toFixed(1)} of ${FROZEN.minWeeksAfterCutoff} weeks since the cutoff`);
  if (refusals.length > 0) return abort(refusals);

  const records = (await allRecords(null)).filter((r) => r.arrivedAt < through);
  for (const r of records) {
    if (r.cohort === "prospective" && r.arrivedAt < cutoff) refusals.push("a row marked prospective arrived before the cutoff");
    if (r.cohort === "historical" && r.arrivedAt >= cutoff) refusals.push("a row marked historical arrived at or after the cutoff");
  }
  const window = records.filter((r) => r.cohort === "prospective" && r.arrivedAt >= cutoff);
  const facts = window.map(ingestionFactsOf);
  const selected = selectLabelSet(facts);
  const byId = new Map(window.map((r) => [r.gmailMessageId, r]));

  const { sets, labels } = await labelsByMessage();
  if (sets.length === 0) refusals.push("no prospective label datasets exist");
  const unfetchable = new Set<string>();
  for (const s of sets) {
    try { for (const id of readManifest(s.name).missing) unfetchable.add(id); } catch { refusals.push(`local snapshot missing for ${s.name}`); }
    if (!existsSync(join(evalDir(), `${s.name}.audit-ids.txt`))) refusals.push(`dataset ${s.name} has no frozen audit list (run npm run eval:audit)`);
  }
  const usable = selected.filter((s) => !unfetchable.has(s.gmailMessageId));
  const unlabeled = usable.filter((s) => !labelFactsFrom(labels.get(s.gmailMessageId)));
  if (unlabeled.length > 0) refusals.push(`${unlabeled.length} selected messages are not labeled`);
  const unread = window.filter((r) => r.plannedRead && r.modelStatus === null);
  if (unread.length > 0) refusals.push(`${unread.length} planned model reads are missing`);
  if (window.some((r) => r.legacyQueryMatch === null)) refusals.push("some rows have no recorded legacy-query flag");
  if (window.some((r) => r.modelStatus !== null && r.modelUngrounded === null)) refusals.push("some model reads were never grounding-audited");
  if (refusals.length > 0) return abort(refusals);

  const rows: AnalysisRow[] = usable.map((s) => toAnalysisRow(byId.get(s.gmailMessageId)!, s, labelFactsFrom(labels.get(s.gmailMessageId))!));
  assertAllReal(rows);
  const population: Population = {
    candidateRows: window.filter((r) => r.isCandidate).length, plannedReads: window.filter((r) => r.plannedRead).length, vetoed: window.filter((r) => r.isCandidate && !r.plannedRead).length,
    legacyOnlyRows: window.filter((r) => !r.isCandidate && r.legacyQueryMatch).length, nonCandidateArmRows: window.filter((r) => !r.isCandidate && !r.legacyQueryMatch && r.uniformArm).length,
  };
  const analysis = computeAnalysis(rows, population);

  // 4. evidence gate: before the hard stop the analysis does not run (and prints nothing about performance) until every claim has its evidence
  const short = analysis.claims.filter((c) => !c.evidenceMet);
  if (short.length > 0 && !hardStopReached) {
    console.log("NOT YET. Required evidence has not accumulated (no performance figure is shown before the single analysis):");
    for (const c of short) console.log(`  ${pad(c.id, 15)} effective n ${c.effectiveN.toFixed(1)} of ${c.requiredN}`);
    return;
  }

  const toolingHash = sha256(readFileSync("scripts/prospective.ts", "utf8")).slice(0, 16);
  const toolingDiffers = !SCRATCH && tryGit("diff", "--quiet", FROZEN.freezeTag, "--", "scripts/prospective.ts", "scripts/shadow.ts") === null;
  const toolingNote = SCRATCH ? "not compared with the tag (scratch rehearsal)" : toolingDiffers ? "DIFFERS from the freeze tag (disclosed; the estimators in lib/recruiting/shadow are frozen separately)" : "identical to the freeze tag";
  const header = [
    ...(SCRATCH ? ["*** SCRATCH REHEARSAL, NOT EVIDENCE: run against a throwaway database with a test clock; the tag check was skipped ***"] : []),
    `PROSPECTIVE EVALUATION RESULT · ${FROZEN.protocol} · ${now.toISOString()}`,
    `tooling: scripts/prospective.ts sha256 ${toolingHash}; ${toolingNote}`,
    SCRATCH ? `candidate: ${FROZEN.freezeTag} (not checked in a scratch rehearsal)` : `candidate: tag ${FROZEN.freezeTag} @ ${tryGit("rev-parse", FROZEN.freezeTag)} · lib/recruiting ${tagTree} · lib/opportunities ${tagOpp}`,
    `reader ${READER_VERSION_V3} · pipeline ${PIPELINE_VERSION} · extractor ${EXTRACTOR_VERSION}`,
    `window: ${FROZEN.cutoff} to ${through.toISOString()} (hard stop ${FROZEN.hardStop}${hardStopReached ? ", reached" : ""})`,
    `datasets: ${sets.map((s) => s.name).sort().join(", ")}`,
    `selected ${selected.length}, analyzed ${usable.length}, dropped as unfetchable ${selected.length - usable.length}; selection hash ${sha256(usable.map((s) => s.gmailMessageId).sort().join("\n")).slice(0, 16)}`,
    short.length > 0 ? `INSUFFICIENT EVIDENCE at the hard stop for: ${short.map((c) => c.id).join(", ")}. The outcome is inconclusive; the bar is not lowered.` : "evidence requirements met for every claim",
  ];
  const text = formatAnalysis(analysis, header).replace(/^OUTCOME: .*$/m, short.length > 0 && analysis.decision.overall === "supported" ? "OUTCOME: INCONCLUSIVE" : `OUTCOME: ${analysis.decision.overall.toUpperCase().replace("_", " ")}`);
  writePrivateFile(resultFile, text + "\n");
  chmodSync(resultFile, 0o400);
  console.log(text);
  console.log(`\nwritten read-only: ${resultFile}\nsha256 ${sha256(text + "\n")}`);
}

function abort(reasons: string[]) {
  console.error("analysis refused:");
  for (const r of [...new Set(reasons)]) console.error(`  - ${r}`);
  process.exitCode = 1;
}

// ------------------------------------------------------------------ synthetic-run
async function syntheticRun() {
  console.log("================ SYNTHETIC RUN: fixtures only, NOT EVIDENCE, nothing is read from Gmail or written to the database ================");
  const base: SyntheticParams = { factSeed: 20261201, readerSeed: 1, weeks: 14, weeklyPerMailbox: 90, prevalence: 0.07, quality: "good" };
  const scenarios: Array<[string, SyntheticParams]> = [
    ["good system, ample data", base],
    ["good system, borderline data", { ...base, weeklyPerMailbox: 60, prevalence: 0.06 }],
    ["marginal system, ample data", { ...base, quality: "marginal" }],
    ["poor system, ample data", { ...base, quality: "poor" }],
    ["good system, too little data", { ...base, weeks: 3, weeklyPerMailbox: 40 }],
  ];
  console.log(pad("scenario", 32) + pad("outcome", 15) + "claims (S supported / N not supported / I inconclusive; * = evidence short)");
  let first: ReturnType<typeof runSyntheticPipeline> | null = null;
  for (const [name, p] of scenarios) {
    const r = runSyntheticPipeline(p);
    first ??= r;
    assertAllSynthetic(r.rows);
    const tag = (c: { verdict: string; evidenceMet: boolean }) => `${c.verdict === "supported" ? "S" : c.verdict === "not_supported" ? "N" : "I"}${c.evidenceMet ? "" : "*"}`;
    console.log(pad(name, 32) + pad(r.analysis.decision.overall, 15) + r.analysis.claims.map((c) => `${c.id}:${tag(c)}`).join(" "));
  }
  // invariants
  const a = runSyntheticPipeline({ ...base, readerSeed: 7, quality: "good" }), b = runSyntheticPipeline({ ...base, readerSeed: 8, quality: "poor" });
  const ids = (r: typeof a) => r.selected.map((s) => `${s.gmailMessageId}:${s.stratum}`).join(",");
  const checks: Array<[string, boolean]> = [
    ["label set identical whatever the readers said", ids(a) === ids(b)],
    ["every selected message is prospective-eligible", a.selected.every((s) => s.arrivedAt >= new Date(FROZEN.cutoff) && s.arrivedAt < new Date(FROZEN.eligibleThrough))],
    ["fixtures are rejected by the real analysis guard", (() => { try { assertAllReal(a.rows); return false; } catch { return true; } })()],
    ["outcome logic is deterministic", JSON.stringify(runSyntheticPipeline(base).analysis.decision) === JSON.stringify(runSyntheticPipeline(base).analysis.decision)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log("\n--- full report for the first scenario (good system, ample data) ---");
  console.log(formatAnalysis(first!.analysis, ["SYNTHETIC — NOT EVIDENCE", `fixtures: ${first!.records.length} rows, ${first!.selected.length} selected`]));
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

// ------------------------------------------------------------------ power
function power() {
  const d = FROZEN.powerDesign, c = FROZEN.claims, r = requirements();
  const f = (x: number) => x.toFixed(2);
  console.log(`## Minimum evidence (recomputed from the frozen design: ${d.power * 100}% power at true rate ${d.rate}, agreement error ${d.agreementError * 100}%, review ${d.reviewRate * 100}%)\n`);
  console.log("| Claim | Effective n needed | Frozen value |\n|---|---|---|");
  console.log(`| Strict recall and improvement (positives) | ${r.recallPositives} (recall alone ${r.detail.strictRecallAlone}, improvement alone ${r.detail.improvementAlone}) | ${FROZEN.minimumEvidence.recallPositives} |`);
  console.log(`| Precision (v2 recruiting decisions) | ${r.precisionDecisions} | ${FROZEN.minimumEvidence.precisionDecisions} |`);
  console.log(`| Event-type accuracy | ${r.typeDecisions} | ${FROZEN.minimumEvidence.typeDecisions} |`);
  console.log(`| Agreement-region error | ${r.agreementRows} | ${FROZEN.minimumEvidence.agreementRows} |`);
  console.log(`| Review rate | ${r.reviewReads} | ${FROZEN.minimumEvidence.reviewReads} |`);
  console.log(`\n## Chance a claim is declared SUPPORTED, by true rate (rule: point >= ${c.precision.target * 100}% and lower bound >= ${c.precision.lowerMin * 100}%)\n`);
  const ns = [35, 45, 70, 150, 400], rates = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  console.log(`| Effective n | ${rates.map((x) => `true ${x * 100}%`).join(" | ")} |\n|---|${rates.map(() => "---").join("|")}|`);
  for (const n of ns) console.log(`| ${n} | ${rates.map((x) => f(powerAtLeast(n, x, c.precision.target, c.precision.lowerMin))).join(" | ")} |`);
  console.log("\n## Effective n for 80% power by true rate (at-least claims)\n");
  console.log(`| True rate | ${[0.95, 0.9, 0.85, 0.82].join(" | ")} |\n|---|---|---|---|---|`);
  console.log(`| Effective n | ${[0.95, 0.9, 0.85, 0.82].map((x) => minimumN((n) => powerAtLeast(n, x, c.precision.target, c.precision.lowerMin)) ?? ">3000").join(" | ")} |`);
  console.log("\n## Chance of 'supported' for the two ceilings, by effective n\n");
  console.log("| n | agreement error true 0.5% | 1% | 1.5% | review true 3% | 5% | 7% |\n|---|---|---|---|---|---|---|");
  for (const n of [100, 150, 253, 400]) console.log(`| ${n} | ${[0.005, 0.01, 0.015].map((x) => f(powerAtMost(n, x, c.agreementError.target, c.agreementError.upperMax))).join(" | ")} | ${[0.03, 0.05, 0.07].map((x) => f(powerAtMost(n, x, c.reviewRate.target, c.reviewRate.upperMax))).join(" | ")} |`);
  console.log(`\n## Will the evidence arrive by the hard stop? (planning assumptions: ${PLANNING.weeklyEligible} eligible messages a week across both mailboxes, ${PLANNING.weeks} weeks of eligible mail; "effective share" is the effective sample as a fraction of the positive count, lowered by hiring-process clustering)\n`);
  console.log("Expected effective positives by the end of the eligible window (requirement " + FROZEN.minimumEvidence.recallPositives + "):\n");
  const ratios = [0.3, 0.45, 0.7];
  console.log(`| Positive prevalence | ${ratios.map((q) => `effective share ${q}`).join(" | ")} |\n|---|${ratios.map(() => "---").join("|")}|`);
  for (const p of [0.01, 0.02, 0.03, 0.038, 0.05, 0.065, 0.08, 0.1]) {
    console.log(`| ${(p * 100).toFixed(1)}% | ${ratios.map((q) => { const x = feasibility(p, { ...PLANNING, effectivePerPositive: q }); return `${x.expectedEffectiveByEnd.toFixed(0)} (${x.reachesInTime ? "reaches" : "short"})`; }).join(" | ")} |`);
  }
}

// ------------------------------------------------------------------ freeze-check
async function freezeCheck() {
  const results: Array<[boolean, string, string]> = [];
  const check = (ok: boolean, name: string, detail = "") => results.push([ok, name, detail]);
  const now = new Date(), cutoff = new Date(FROZEN.cutoff);
  check(!tryGit("status", "--porcelain"), "working tree is clean");
  const head = tryGit("rev-parse", "HEAD"), remote = tryGit("rev-parse", "origin/main");
  check(!!head && head === remote, "HEAD is pushed (equals origin/main)", `${head?.slice(0, 7)} vs ${remote?.slice(0, 7)}`);
  check(!tryGit("rev-parse", "--verify", "--quiet", `refs/tags/${FROZEN.freezeTag}`), `tag ${FROZEN.freezeTag} does not exist yet`);
  check(now <= new Date(FROZEN.tagDeadline), "tag deadline not passed", `now ${now.toISOString()} <= ${FROZEN.tagDeadline}`);
  const daysAhead = (cutoff.getTime() - now.getTime()) / DAY;
  check(daysAhead >= FROZEN.minDaysTagBeforeCutoff, `cutoff is at least ${FROZEN.minDaysTagBeforeCutoff} days after the tag`, `${daysAhead.toFixed(1)} days`);
  check(FROZEN.readerVersion === READER_VERSION_V3 && FROZEN.extractorVersion === EXTRACTOR_VERSION && FROZEN.pipelineVersion === PIPELINE_VERSION, "frozen versions equal the code's versions");
  const doc = existsSync("docs/prospective-evaluation-protocol.md") ? readFileSync("docs/prospective-evaluation-protocol.md", "utf8") : "";
  const missing = missingFromProtocol(doc);
  check(doc.length > 0 && missing.length === 0, "protocol document states every frozen parameter", missing.join("; "));
  check(!/PROPOSED|DRAFT/.test(doc), "protocol document is no longer marked draft or proposed");
  const req = requirements();
  check(JSON.stringify({ r: req.recallPositives, p: req.precisionDecisions, t: req.typeDecisions, a: req.agreementRows, v: req.reviewReads }) === JSON.stringify({ r: FROZEN.minimumEvidence.recallPositives, p: FROZEN.minimumEvidence.precisionDecisions, t: FROZEN.minimumEvidence.typeDecisions, a: FROZEN.minimumEvidence.agreementRows, v: FROZEN.minimumEvidence.reviewReads }), "minimum evidence equals the recomputed power analysis");
  check((process.env.BLIND_SETUP_LOCK ?? "") === "1", "product sync is locked (BLIND_SETUP_LOCK=1)");
  const db = getDb();
  const { sql } = await import("drizzle-orm");
  const con = (await db.execute(sql`select count(*)::int as n from pg_constraint where conname = 'shadow_reads_cohort_matches_cutoff'`)) as unknown as Array<{ n: number }>;
  check(con[0]?.n === 1, "database enforces cohort/cutoff consistency (migration 0006 applied)");
  const early = (await db.execute(sql`select count(*)::int as n from shadow_reads where arrived_at >= ${FROZEN.cutoff}::timestamptz or cohort = 'prospective'`)) as unknown as Array<{ n: number }>;
  check(early[0]?.n === 0, "no prospective evidence exists yet (the window has not started)", `${early[0]?.n} rows`);
  const sets = await db.select({ n: evalDatasets.name }).from(evalDatasets).where(like(evalDatasets.name, `${FROZEN.datasetPrefix}%`));
  check(sets.length === 0, "no prospective label datasets exist yet", `${sets.length}`);
  const synth = runSyntheticPipeline({ factSeed: 20261201, readerSeed: 1, weeks: 14, weeklyPerMailbox: 90, prevalence: 0.07, quality: "good" });
  const synth2 = runSyntheticPipeline({ factSeed: 20261201, readerSeed: 99, weeks: 14, weeklyPerMailbox: 90, prevalence: 0.07, quality: "poor" });
  check(synth.analysis.decision.overall === "supported" && synth2.analysis.decision.overall === "not_supported", "synthetic end-to-end workflow behaves (good supported, poor not supported)");
  check(synth.selected.map((s) => s.gmailMessageId).join() === synth2.selected.map((s) => s.gmailMessageId).join(), "synthetic leakage check: label set independent of reader behavior");
  check(INGESTION_COLUMNS.length === 11, "label-set query is limited to the 11 ingestion columns");
  for (const [ok, name, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  const bad = results.filter(([ok]) => !ok).length;
  console.log(bad === 0 ? "\nALL PRECONDITIONS SATISFIED: the freeze tag may be created." : `\n${bad} precondition(s) NOT satisfied: do not tag.`);
  if (bad > 0) process.exitCode = 1;
}
