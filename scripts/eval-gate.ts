/**
 * Cached-replay regression gate for decision logic (reader, assist, refinement, identity, lifecycle, decision engine).
 *
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/eval-gate.ts [--engine current|shadow] [--baseline eval/baseline.json] [--json out.json]
 *   ... --write-baseline eval/baseline.json     (explicit; prints what changed; never run implicitly)
 *
 * Replays every development fixture in eval/dev from its FROZEN cached model readings (no model call, a few seconds in total), pools the counts, and compares them with the
 * committed baseline. A change to decision logic is not accepted when recall, type accuracy, lifecycle accuracy, grouping or source evidence get worse, or when false
 * opportunities, wrong merges, splits or review burden grow, beyond the stated tolerance. A fixture or cache whose hash differs from the baseline's invalidates the baseline.
 *
 * Exit codes: 0 pass, 1 regression, 2 setup error. The development fixtures are CONTAMINATED for unbiased claims (their failures have been inspected); a fresh sealed fixture is
 * kept outside the repository for release validation (docs/generalization-policy.md).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURES = ["J", "K", "L", "M", "N", "X"] as const;
type Counts = Record<string, number>;
export type Metrics = Record<string, number>;
export type Baseline = {
  version: 1;
  engine: string;
  commit: string;
  note: string;
  fixtures: Record<string, { fixtureSha256: string; cacheSha256: string; counts: Counts }>;
  pooled: Metrics;
};

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Every number the gate reports, derived from the harness counts. Higher is better unless the name is in LOWER_IS_BETTER. */
export function metricsOf(c: Counts): Metrics {
  const journeys = c.journeys - c.noHome;
  return {
    recruitingPrecision: pct(c.tp, c.tp + c.fp),
    recruitingRecall: pct(c.tp, c.tp + c.fn),
    typeAccuracy: pct(c.typeOk, c.typeN),
    pairPrecision: pct(c.pairTp, c.pairTp + c.pairFp),
    pairRecall: pct(c.pairTp, c.pairTp + c.pairFn),
    statusAccuracy: pct(c.statusOk, journeys),
    outcomeAccuracy: pct(c.outcomeOk, journeys),
    stageAccuracy: pct(c.stageOk, c.stageN),
    nextActionAccuracy: pct(c.actOk, journeys),
    nextActionEvidenceOnly: pct(c.actNormOk, c.actNormN),
    sourceEvidence: pct(c.evidenceOk, c.evidenceN),
    contradictionsFlagged: pct(c.contraFlagged, c.contra),
    reviewJustifiedShare: pct(c.reviewJustified, c.reviewItems),
    importantJustifiedShare: pct(c.attentionJustified, c.attention),
    // counts (lower is better)
    falseOpportunities: c.fp,
    missedApplications: c.fn,
    wrongMerges: c.pairFp,
    missedLinks: c.pairFn,
    journeysSplit: c.split,
    opportunitiesMergingJourneys: c.merged,
    journeysNotFound: c.noHome,
    reviewItems: c.reviewItems,
    importantItems: c.attention,
  };
}
export const LOWER_IS_BETTER = new Set(["falseOpportunities", "missedApplications", "wrongMerges", "missedLinks", "journeysSplit", "opportunitiesMergingJourneys", "journeysNotFound", "reviewItems", "importantItems"]);
/** Pooled tolerance in points (for percentages) and as a share of the baseline count (for counts, with an absolute floor of 2). */
export const TOLERANCE = { points: 1.0, perFixturePoints: 4.0, countShare: 0.1, countFloor: 2 };
/** The per-fixture checks cover the lifecycle and recall numbers a person feels first. */
export const PER_FIXTURE = ["recruitingRecall", "statusAccuracy", "outcomeAccuracy"];

export function compare(base: Metrics, now: Metrics, label: string, tol: { points: number; countShare: number; countFloor: number }, only?: string[]): string[] {
  const problems: string[] = [];
  for (const k of Object.keys(base)) {
    if (only && !only.includes(k)) continue;
    const b = base[k], n = now[k];
    if (LOWER_IS_BETTER.has(k)) {
      const allowed = Math.max(tol.countFloor, Math.ceil(b * tol.countShare));
      if (n > b + allowed) problems.push(`${label} ${k}: ${b} -> ${n} (allowed +${allowed})`);
    } else if (n < b - tol.points) problems.push(`${label} ${k}: ${b} -> ${n} (allowed -${tol.points})`);
  }
  return problems;
}

function runFixture(root: string, name: string, engine: string): Counts {
  const out = join(mkdtempSafe(), `${name}.json`);
  execFileSync(process.execPath, ["--no-warnings", "--import", "./scripts/loader/register.mjs", "scripts/eval-journeys.ts", join(root, `eval/dev/journeys-${name}.json`), "--semantic", "--replay", "--cache", join(root, `eval/dev/cache-${name}.json`), "--engine", engine, ...(engine === "phase2" ? ["--role-cache", join(root, `eval/dev/roles-${name}.json`)] : []), "--json", out], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  return (JSON.parse(readFileSync(out, "utf8")) as { counts: Counts }).counts;
}
let tmp: string | null = null;
function mkdtempSafe(): string { if (!tmp) { tmp = join(tmpdir(), `eval-gate-${process.pid}`); mkdirSync(tmp, { recursive: true }); } return tmp; }

export function pool(all: Record<string, Counts>): Counts {
  const sum: Counts = {};
  for (const c of Object.values(all)) for (const [k, v] of Object.entries(c)) sum[k] = (sum[k] ?? 0) + v;
  return sum;
}

export function evaluateAll(root: string, engine: string): { counts: Record<string, Counts>; hashes: Record<string, { fixtureSha256: string; cacheSha256: string }> } {
  const counts: Record<string, Counts> = {}, hashes: Record<string, { fixtureSha256: string; cacheSha256: string }> = {};
  for (const f of FIXTURES) {
    const fx = join(root, `eval/dev/journeys-${f}.json`), ca = join(root, `eval/dev/cache-${f}.json`);
    if (!existsSync(fx) || !existsSync(ca)) throw new Error(`setup: missing eval/dev fixture or cache for ${f}`);
    hashes[f] = { fixtureSha256: sha256(fx), cacheSha256: sha256(ca) };
    counts[f] = runFixture(root, f, engine);
  }
  return { counts, hashes };
}

function main() {
  const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
  const root = process.cwd();
  const engine = arg("--engine") ?? "current";
  const basePath = arg("--baseline") ?? "eval/baseline.json";
  const writePath = arg("--write-baseline");
  const jsonOut = arg("--json");
  let result;
  try { result = evaluateAll(root, engine); } catch (e) { console.error(`eval-gate setup error: ${(e as Error).message}`); process.exit(2); }
  const pooledCounts = pool(result.counts);
  const pooled = metricsOf(pooledCounts);
  const perFixture = Object.fromEntries(Object.entries(result.counts).map(([k, c]) => [k, metricsOf(c)]));
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ engine, pooled, perFixture, counts: result.counts }, null, 1));

  if (writePath) {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "lib", "scripts", "eval"], { cwd: root }).toString().trim() !== "";
    const b: Baseline = { version: 1, engine, commit: dirty ? `${commit}+uncommitted` : commit, note: arg("--note") ?? "", fixtures: Object.fromEntries(FIXTURES.map((f) => [f, { ...result.hashes[f], counts: result.counts[f] }])), pooled };
    writeFileSync(writePath, `${JSON.stringify(b, null, 1)}\n`);
    console.log(`baseline written: ${writePath} (engine ${engine}, commit ${b.commit})`);
    return;
  }

  if (!existsSync(basePath)) { console.error(`eval-gate setup error: no baseline at ${basePath}`); process.exit(2); }
  let base = JSON.parse(readFileSync(basePath, "utf8")) as Baseline;
  // --against best: the RELEASE gate. The shadow engine must be at least as good as the element-wise best of the frozen baseline and the pre-regression reference, on every metric, so
  // recovering one area cannot be paid for by losing another that either earlier version had. It sits next to the ordinary gate; neither is relaxed to make the other pass.
  if (process.argv.includes("--against") && arg("--against") === "best") {
    const ref = JSON.parse(readFileSync(arg("--reference") ?? "eval/reference-8ee0e95.json", "utf8")) as Baseline;
    const bestOf = (a: Metrics, b: Metrics): Metrics => Object.fromEntries(Object.keys(a).map((k) => [k, LOWER_IS_BETTER.has(k) ? Math.min(a[k], b[k]) : Math.max(a[k], b[k])]));
    const merged: Baseline = { ...base, engine: "best-of(baseline,reference)", commit: `${base.commit}+${ref.commit}`, pooled: bestOf(base.pooled, ref.pooled), fixtures: {} };
    for (const f of FIXTURES) {
      if (ref.fixtures[f].fixtureSha256 !== base.fixtures[f].fixtureSha256 || ref.fixtures[f].cacheSha256 !== base.fixtures[f].cacheSha256) { console.error(`eval-gate setup error: reference and baseline disagree about fixture ${f}`); process.exit(2); }
      const best = bestOf(metricsOf(base.fixtures[f].counts), metricsOf(ref.fixtures[f].counts));
      // per-fixture counts are re-derived only for the three per-fixture checks, which are rates; carry the base counts for the hash check and compare the best rates directly
      merged.fixtures[f] = { ...base.fixtures[f], counts: { ...base.fixtures[f].counts, __best: 1 } };
      (merged as unknown as { bestRates: Record<string, Metrics> }).bestRates = { ...((merged as unknown as { bestRates?: Record<string, Metrics> }).bestRates ?? {}), [f]: best };
    }
    base = merged;
  }
  const problems: string[] = [];
  for (const f of FIXTURES) {
    const b = base.fixtures[f];
    if (!b) { problems.push(`baseline has no fixture ${f}`); continue; }
    if (b.fixtureSha256 !== result.hashes[f].fixtureSha256 || b.cacheSha256 !== result.hashes[f].cacheSha256) { console.error(`eval-gate setup error: fixture or cache ${f} differs from the frozen baseline; the baseline is no longer comparable`); process.exit(2); }
  }
  problems.push(...compare(base.pooled, pooled, "pooled", { points: TOLERANCE.points, countShare: TOLERANCE.countShare, countFloor: TOLERANCE.countFloor }));
  const bestRates = (base as unknown as { bestRates?: Record<string, Metrics> }).bestRates;
  for (const f of FIXTURES) problems.push(...compare(bestRates?.[f] ?? metricsOf(base.fixtures[f].counts), perFixture[f], `fixture ${f}`, { points: TOLERANCE.perFixturePoints, countShare: 1, countFloor: 1e9 }, PER_FIXTURE));

  const w = Object.keys(pooled).reduce((a, k) => Math.max(a, k.length), 0);
  console.log(`eval-gate  engine=${engine}  baseline=${base.engine}@${base.commit}`);
  for (const k of Object.keys(pooled)) { const d = pooled[k] - base.pooled[k]; console.log(`  ${k.padEnd(w)}  ${String(base.pooled[k]).padStart(6)} -> ${String(pooled[k]).padStart(6)}  ${d === 0 ? "" : d > 0 ? `+${Math.round(d * 10) / 10}` : `${Math.round(d * 10) / 10}`}`); }
  if (problems.length > 0) { console.error(`\nREGRESSION (${problems.length}):`); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
  console.log("\nGATE PASSED");
}
if (process.argv[1]?.endsWith("eval-gate.ts")) main();
