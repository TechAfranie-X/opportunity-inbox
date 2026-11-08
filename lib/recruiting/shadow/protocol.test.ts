import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { EXTRACTOR_VERSION } from "../version.ts";
import { READER_VERSION_V3 } from "../reader/guide3.ts";
import { missingFromProtocol, protocolTokens } from "./consistency.ts";
import { FROZEN } from "./frozen.ts";
import { PIPELINE_VERSION } from "./shadow.ts";

const root = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(join(root, dir))) {
    if (f === "node_modules" || f === ".next" || f.startsWith(".")) continue;
    const rel = join(dir, f);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out); else if (/\.(ts|tsx)$/.test(f)) out.push(rel);
  }
  return out;
};

test("PROTOCOL: the frozen constants equal the code's own versions", () => {
  assert.equal(FROZEN.readerVersion, READER_VERSION_V3);
  assert.equal(FROZEN.extractorVersion, EXTRACTOR_VERSION);
  assert.equal(FROZEN.pipelineVersion, PIPELINE_VERSION);
});

test("PROTOCOL: the document states every frozen parameter and is not marked provisional", () => {
  const doc = read("docs/prospective-evaluation-protocol.md");
  assert.deepEqual(missingFromProtocol(doc), []);
  assert.doesNotMatch(doc, /\bDRAFT\b|\bPROPOSED\b/);
  assert.ok(protocolTokens().length > 20);
});

test("PROTOCOL: the schedule is internally consistent", () => {
  const t = (s: string) => new Date(s).getTime();
  const DAY = 86400000;
  assert.ok(t(FROZEN.cutoff) - t(FROZEN.tagDeadline) >= FROZEN.minDaysTagBeforeCutoff * DAY, "the tag deadline leaves at least 7 days before the cutoff");
  assert.ok(t(FROZEN.cutoff) < t(FROZEN.eligibleThrough) && t(FROZEN.eligibleThrough) < t(FROZEN.hardStop));
  assert.equal((t(FROZEN.hardStop) - t(FROZEN.eligibleThrough)) / DAY, FROZEN.labelWithinDays, "the final labeling lag is exactly the labeling window");
  assert.ok(t(FROZEN.eligibleThrough) - t(FROZEN.cutoff) >= FROZEN.minWeeksAfterCutoff * 7 * DAY);
  assert.equal(FROZEN.uniformRate * FROZEN.s2Weight, 1);
  assert.equal(FROZEN.uniformRate, 0.25);
  assert.equal(FROZEN.s2Weight, 4);
});

test("PROTOCOL: the locked decisions are the frozen thresholds", () => {
  const c = FROZEN.claims;
  assert.deepEqual(c.strictRecall, { target: 0.8, lowerMin: 0.7 });
  assert.deepEqual(c.precision, { target: 0.8, lowerMin: 0.7 });
  assert.deepEqual(c.typeAccuracy, { target: 0.8, lowerMin: 0.7 });
  assert.deepEqual(c.agreementError, { target: 0.02, upperMax: 0.04 });
  assert.equal(c.reviewRate.target, 0.08);
  assert.ok(c.reviewRate.upperMax > c.reviewRate.target && c.reviewRate.upperMax <= 0.15, "a predeclared, reasonable upper-bound margin");
  assert.equal(c.ungrounded.max, 0);
  assert.equal(c.improvement.lowerAbove, 0);
});

test("COHORT: the database constraint and its migration carry the same cutoff as the frozen constant", () => {
  const iso = FROZEN.cutoff.replace(".000Z", "Z");
  assert.ok(read("lib/db/schema.ts").includes(`'${iso}'::timestamptz`), "schema.ts");
  const migration = readdirSync(join(root, "drizzle")).filter((f) => f.endsWith(".sql")).map((f) => read(join("drizzle", f))).join("\n");
  assert.ok(migration.includes(`'${iso}'::timestamptz`) && migration.includes("shadow_reads_cohort_matches_cutoff"), "a migration creates the constraint");
});

test("COHORT: no source file lets the environment set the cutoff or the sampling rate", () => {
  const offenders = [...walk("lib"), ...walk("app"), ...walk("scripts")].filter((f) => !f.endsWith(".test.ts") && /READER_V2_(CUTOFF|UNIFORM_RATE)/.test(read(f)));
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(read(".env.example"), /READER_V2_(CUTOFF|UNIFORM_RATE)=/);
});

test("DRY RUN: assumeCutoff is refused outside a dry run, and a dry run never writes", () => {
  const collect = read("lib/recruiting/shadow/collect.ts");
  assert.match(collect, /if \(opts\.assumeCutoff && !opts\.dryRun\) throw/);
  assert.match(collect, /const stored = opts\.dryRun \? 0 : await insertShadowReads\(records\)/);
  assert.equal((collect.match(/insertShadowReads\(/g) ?? []).length, 1, "the only write path is behind the dry-run guard");
  assert.match(read("scripts/shadow.ts"), /--assume-cutoff is only allowed with --dry-run/);
});

test("LEAKAGE: the label-set command reads ingestion columns only, never the full records", () => {
  const prospective = read("scripts/prospective.ts");
  const a = prospective.indexOf("async function labelSet"), b = prospective.indexOf("// ------------------------------------------------------------------ analyze");
  const labelSet = prospective.slice(a, b);
  assert.match(labelSet, /ingestionFacts\(/);
  assert.doesNotMatch(labelSet, /allRecords|reportRows|pendingModelReads|getShadowRecord/, "label-set never loads a reader's output");
  const store = read("lib/recruiting/shadow/store.ts");
  assert.match(store, /INGESTION_COLUMNS\.map/);
  assert.match(read("lib/recruiting/shadow/labelset.ts"), /export const INGESTION_COLUMNS/);
});

test("ANALYSIS: it refuses synthetic rows, refuses a modified candidate, and runs once", () => {
  const prospective = read("scripts/prospective.ts");
  assert.match(prospective, /assertAllReal\(rows\)/);
  assert.match(prospective, /differs from the freeze tag/);
  assert.match(prospective, /the analysis runs once/);
  assert.match(prospective, /chmodSync\(resultFile, 0o400\)/);
  assert.match(prospective, /hardStopReached/);
});

test("ANALYSIS: the decision logic never reads the sensitivity block", () => {
  const analysis = read("lib/recruiting/shadow/analysis.ts");
  const decide = analysis.slice(analysis.indexOf("export function decide"), analysis.indexOf("function countBy"));
  assert.doesNotMatch(decide, /sensitivity|secondary/);
});

test("PRIVACY: nothing in the prospective tooling logs or persists message text", () => {
  for (const f of ["lib/recruiting/shadow/collect.ts", "lib/recruiting/shadow/store.ts", "lib/recruiting/shadow/analysis.ts", "lib/recruiting/shadow/labelset.ts", "scripts/prospective.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /console\.(log|error)\([^)]*(bodyText|\.body\b|subject)/, f);
  }
  assert.doesNotMatch(read("docs/prospective-evaluation-protocol.md"), /afrane|owusu|agyei|aphranie/i);
});

test("REHEARSAL: the clock and tag-check overrides exist only behind a scratch_ database name", () => {
  const prospective = read("scripts/prospective.ts");
  assert.match(prospective, /startsWith\("scratch_"\)/);
  assert.match(prospective, /SCRATCH && process\.env\.PROSPECTIVE_NOW/);
  assert.equal((prospective.match(/PROSPECTIVE_NOW/g) ?? []).length, 2, "the override is referenced only in the guarded clock (one mention in its comment-free definition and one in the guard)");
  assert.match(prospective, /if \(!SCRATCH\) \{/);
  const freezeCheck = prospective.slice(prospective.indexOf("async function freezeCheck"));
  assert.doesNotMatch(freezeCheck, /clock\(\)|PROSPECTIVE_NOW|SCRATCH/, "freeze-check always uses the real clock and the real database");
});
