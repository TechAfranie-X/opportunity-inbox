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

// ======================= freeze-integrity audit: one canonical value per frozen parameter =======================
import { PLANNING } from "./power.ts";

const protocolDoc = () => read("docs/prospective-evaluation-protocol.md");
const iso = (s: string) => s.replace(".000Z", "Z");
const pc = (x: number) => `${Math.round(x * 100)}%`;
/** The single table row that mentions `label`, within the numbered section starting at `## <n>.` */
function rowIn(doc: string, section: number, label: string): string {
  const start = doc.indexOf(`\n## ${section}. `);
  const end = doc.indexOf("\n## ", start + 5);
  const body = doc.slice(start, end < 0 ? undefined : end);
  const rows = body.split("\n").filter((l) => l.startsWith("|") && l.includes(label));
  assert.equal(rows.length, 1, `section ${section} should have exactly one row mentioning "${label}", found ${rows.length}`);
  return rows[0];
}

test("AUDIT: the protocol has exactly one title and unique, sequentially numbered sections", () => {
  const doc = protocolDoc();
  const heads = doc.split("\n").filter((l) => l.startsWith("#"));
  assert.equal(heads.filter((h) => h.startsWith("# ")).length, 1);
  const sections = heads.filter((h) => h.startsWith("## "));
  assert.deepEqual(sections.map((h) => Number(h.match(/^## (\d+)\./)?.[1])), Array.from({ length: sections.length }, (_, i) => i + 1), "numbered 1..N once each, in order");
  assert.equal(new Set(sections).size, sections.length, "no duplicated heading");
  assert.equal(sections.length, 13);
});

test("AUDIT section 1: every row of the frozen-parameters table equals its constant", () => {
  const doc = protocolDoc();
  assert.ok(rowIn(doc, 1, "Cutoff").includes(iso(FROZEN.cutoff)));
  assert.ok(rowIn(doc, 1, "Eligible-through").includes(iso(FROZEN.eligibleThrough)));
  assert.ok(rowIn(doc, 1, "Hard stop").includes(iso(FROZEN.hardStop)));
  const tag = rowIn(doc, 1, "Freeze tag");
  assert.ok(tag.includes(`\`${FROZEN.freezeTag}\``) && tag.includes(FROZEN.tagDeadline.slice(0, 10)));
  assert.ok(rowIn(doc, 1, "Minimum time").includes(`${FROZEN.minWeeksAfterCutoff} weeks`));
  assert.ok(rowIn(doc, 1, "Reader version").includes(FROZEN.readerVersion));
  assert.ok(rowIn(doc, 1, "Pipeline version").includes(FROZEN.pipelineVersion));
  assert.ok(rowIn(doc, 1, "Rules extractor").includes(FROZEN.extractorVersion));
  const sampling = rowIn(doc, 1, "Sampling rate");
  assert.ok(sampling.includes(pc(FROZEN.uniformRate)) && sampling.includes(`weight ${FROZEN.s2Weight}`) && sampling.includes(FROZEN.armHash));
  const intervals = rowIn(doc, 1, "Intervals");
  assert.ok(intervals.includes(FROZEN.bootstrap.resamples.toLocaleString("en-US")) && intervals.includes(String(FROZEN.bootstrap.seed)));
  assert.ok(rowIn(doc, 1, "Label datasets").includes(FROZEN.datasetPrefix));
});

test("AUDIT section 6: every claim row carries exactly its own thresholds", () => {
  const doc = protocolDoc();
  const c = FROZEN.claims;
  const atLeast = (r: { target: number; lowerMin: number }) => [`point >= ${pc(r.target)} and lower bound >= ${pc(r.lowerMin)}`, `point < ${pc(r.target)}`];
  const checks: Array<[string, string[]]> = [
    ["| 1 |", [`lower 95% bound of the difference > ${c.improvement.lowerAbove}`, `point difference <= ${c.improvement.lowerAbove}`]],
    ["| 2 |", atLeast(c.strictRecall)],
    ["| 3 |", atLeast(c.precision)],
    ["| 4 |", atLeast(c.typeAccuracy)],
    ["| 5 |", [`point <= ${pc(c.agreementError.target)} and upper bound <= ${pc(c.agreementError.upperMax)}`, `point > ${pc(c.agreementError.target)}`]],
    ["| 6 |", [`point <= ${pc(c.reviewRate.target)} and upper bound <= ${pc(c.reviewRate.upperMax)}`, `point > ${pc(c.reviewRate.target)}`]],
    ["| 7 |", [`count = ${c.ungrounded.max}`]],
  ];
  for (const [label, expected] of checks) {
    const row = rowIn(doc, 6, label);
    for (const e of expected) assert.ok(row.includes(e), `claim row "${label}" must contain "${e}"; got: ${row}`);
  }
  assert.ok(doc.includes(`The review upper bound of ${pc(c.reviewRate.upperMax)}`));
});

test("AUDIT section 7: every minimum-evidence row carries exactly its own number", () => {
  const doc = protocolDoc(), m = FROZEN.minimumEvidence;
  assert.ok(rowIn(doc, 7, "recall, improvement").includes(`${m.recallPositives} effective positives`));
  assert.ok(rowIn(doc, 7, "(precision)").includes(`${m.precisionDecisions} effective decisions`));
  assert.ok(rowIn(doc, 7, "(event type)").includes(`${m.typeDecisions} effective type decisions`));
  assert.ok(rowIn(doc, 7, "(agreement error)").includes(`${m.agreementRows} agreement-region rows`));
  assert.ok(rowIn(doc, 7, "(review rate)").includes(`${m.reviewReads} model reads`));
  assert.ok(doc.includes(`${FROZEN.labelWithinDays} days to read and label`));
});

test("AUDIT: the only calendar instants the current documents may state are the frozen ones and the freeze-history dates", () => {
  const allowed = new Set([iso(FROZEN.cutoff), iso(FROZEN.eligibleThrough), iso(FROZEN.hardStop), FROZEN.tagDeadline.slice(0, 10), FROZEN.supersedes.date]);
  const allowedDates = new Set([...allowed].map((a) => a.slice(0, 10)));
  for (const f of ["docs/prospective-evaluation-protocol.md", "docs/prospective-power-analysis.md", "docs/architecture-v2-shadow.md"]) {
    for (const m of read(f).match(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?/g) ?? []) {
      assert.ok(allowed.has(m) || allowedDates.has(m), `${f} states an unexpected date/instant: ${m}`);
    }
  }
});

test("AUDIT: stale values from the superseded draft appear nowhere in current documents, code, tests or configuration", () => {
  const stale: Array<[RegExp, string]> = [
    [/2026-11-16/, "the old cutoff"], [/\bweight 10\b/, "the old S2 weight"], [/uniformRate:\s*0\.05/, "the old sampling rate"],
    [/READER_V2_(CUTOFF|UNIFORM_RATE)\s*=/, "an environment override that no longer exists"], [/at least 50 labeled/i, "the old 50-positive rule"],
    [/Fifty S1/i, "the old 50-positive rule"], [/\bPROPOSED\b/, "provisional wording"], [/Owner checklist/i, "the old owner checklist"],
    [/extended once|one extension/i, "the removed extension"], [/\bDRAFT\b/, "provisional wording"],
  ];
  const docs = ["docs/prospective-evaluation-protocol.md", "docs/prospective-power-analysis.md", "docs/architecture-v2-shadow.md"];
  const files = [...docs, ".env.example", "scripts/prospective.ts", "scripts/shadow.ts", ...walk("lib/recruiting/shadow")].filter((f) => f !== "lib/recruiting/shadow/protocol.test.ts");
  // The words DRAFT/PROPOSED legitimately appear in code that CHECKS for them (freeze-check), so they are policed in documents only.
  const docsOnly = new Set(["provisional wording"]);
  for (const f of files) for (const [re, why] of stale) if (!docsOnly.has(why) || docs.includes(f)) assert.doesNotMatch(read(f), re, `${f} contains ${why}`);
});

test("AUDIT: no code outside frozen.ts restates a frozen date or the sampling rate", () => {
  const files = [...walk("lib/recruiting/shadow"), "scripts/prospective.ts", "scripts/shadow.ts"].filter((f) => !f.endsWith(".test.ts") && !f.endsWith("frozen.ts"));
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /20(26|27)-\d{2}-\d{2}/, `${f} restates a calendar date`);
    assert.doesNotMatch(src, /uniformRate:\s*0\./, `${f} restates the sampling rate`);
    assert.doesNotMatch(src, /s2Weight:\s*\d/, `${f} restates the S2 weight`);
  }
});

test("AUDIT: the freeze tag is named once, and the superseded tag only in the freeze history", () => {
  const doc = protocolDoc();
  assert.equal(doc.split(FROZEN.freezeTag).length - 1, 1, "the current tag is stated in exactly one place (section 1)");
  const history = doc.slice(doc.indexOf("\n## 13. Freeze history"));
  assert.ok(history.includes(FROZEN.supersedes.tag) && history.includes(FROZEN.supersedes.commit));
  assert.equal(doc.split(FROZEN.supersedes.tag).length - 1, 1, "the superseded tag appears only once, in the history");
  assert.ok(history.includes("before any prospective evidence existed"));
  assert.notEqual(FROZEN.freezeTag, FROZEN.supersedes.tag);
  assert.match(FROZEN.supersedes.commit, /^[0-9a-f]{40}$/);
});

test("AUDIT: the planning assumption for the eligible window cannot drift from the frozen dates", () => {
  const weeks = (new Date(FROZEN.eligibleThrough).getTime() - new Date(FROZEN.cutoff).getTime()) / (7 * 86400000);
  assert.ok(Math.abs(PLANNING.weeks - weeks) < 0.1, `${PLANNING.weeks} vs ${weeks}`);
});
