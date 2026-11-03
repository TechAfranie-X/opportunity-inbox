// Label audit, labels only: npm run eval:audit -- --dataset <name> [--labeler me] [--no-sample 40] [--seed <s>]
// Prints a content-free summary and writes the review list (message ids + reasons) beside the snapshot, mode 0600.
// Imports no extractor, predictions or evaluator. Changes no labels.
import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { evalDatasets, labels as labelsTable } from "../lib/db/schema.ts";
import { evalDir } from "../lib/eval-store/private-fs.ts";
import { latestLabels, summarize } from "../lib/eval-store/label-audit.ts";
import { sampleIds } from "../lib/eval-store/snapshot.ts";
import { readSnapshot } from "../lib/eval-store/snapshot.ts";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) args.set(argv[i].slice(2), argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
const name = args.get("dataset") ?? (console.error("error: missing --dataset"), process.exit(1));
const labeler = args.get("labeler") ?? "me";
const nNo = Number(args.get("no-sample") ?? 40);
const seed = args.get("seed") ?? `${name}:label-audit`;

const db = getDb();
const [ds] = await db.select().from(evalDatasets).where(eq(evalDatasets.name, name)).limit(1);
if (!ds) { console.error(`error: dataset "${name}" is not registered`); process.exit(1); }
const members = readSnapshot(name).manifest.memberIds; // ids only; no message content is read here
const rows = (await db.select().from(labelsTable).where(eq(labelsTable.datasetId, ds.id))).filter((r) => r.labeler === labeler);
const labels = latestLabels(rows.map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field, value: r.value, createdAt: r.createdAt })));
const sum = summarize(labels, members);
const pct = (k: number, n: number) => (n ? `${k} (${((100 * k) / n).toFixed(1)}%)` : `${k}`);
const fmt = (d: Array<[string, number]>) => d.map(([k, v]) => `${k}=${v}`).join("  ");

console.log(`labels only · ${name} · labeler "${labeler}" · no predictions, extractor output or evaluation loaded`);
console.log(`total labeled ${sum.totalLabeled} of ${sum.expected} members (unlabeled ${sum.unlabeledMembers})`);
console.log(`recruiting Yes ${pct(sum.yes, sum.totalLabeled)} · No ${pct(sum.no, sum.totalLabeled)}`);
console.log(`type (Yes):  ${fmt(sum.types)}`);
console.log(`stage (Yes): ${fmt(sum.stages)}`);
console.log(`company: known ${sum.company.known} · cannot tell ${sum.company.unknown} · not_applicable ${sum.company.notApplicable}`);
console.log(`role:    known ${sum.role.known} · none stated (not_applicable) ${sum.role.notApplicable} · cannot tell ${sum.role.unknown}`);
console.log(`event date: known ${sum.eventDate.known} · none (not_applicable) ${sum.eventDate.notApplicable} · cannot tell ${sum.eventDate.unknown}`);
console.log(`actionable: ${fmt(sum.actionable)}`);
console.log(`urgency:    ${fmt(sum.urgency)}`);
console.log(`distinct opportunity ids: ${sum.distinctOpportunities}`);
console.log(`ambiguous: ${sum.unknownLabelRows} label rows = "unknown" across ${sum.messagesWithUnknown} messages`);
console.log(`consistency flags (labels contradicting each other or the guide): ${sum.flaggedMessages} messages`);
console.log(`  by reason: ${fmt(sum.flagReasons)}`);

// Review list: every Yes, a seeded sample of No, and every flagged message (unknown fields and contradictions).
const yesIds = [...labels].filter(([, l]) => l.is_recruiting === true).map(([id]) => id);
const noIds = [...labels].filter(([, l]) => l.is_recruiting === false).map(([id]) => id).sort();
const noSample = sampleIds(noIds, Math.min(nNo, noIds.length), `${seed}:no`);
const flagged = new Map(sum.flags.map((f) => [f.id, f.reasons]));
const review = new Map<string, string[]>();
for (const id of yesIds) review.set(id, ["recruiting=Yes"]);
for (const id of noSample) review.set(id, [...(review.get(id) ?? []), "sampled No"]);
for (const [id, reasons] of flagged) review.set(id, [...(review.get(id) ?? []), ...reasons]);
const ids = [...review.keys()].sort();
const base = join(evalDir(), `${name}.audit`);
// A frozen review list (read-only) is the review population: label corrections must never change who gets reviewed.
if (existsSync(`${base}-ids.txt`) && (statSync(`${base}-ids.txt`).mode & 0o200) === 0) {
  console.log(`\nreview list is FROZEN (${base}-ids.txt is read-only); not rewritten. Delete it deliberately to re-draw.`);
  process.exit(0);
}
writeFileSync(`${base}-ids.txt`, ids.join("\n") + "\n", { mode: 0o600 }); chmodSync(`${base}-ids.txt`, 0o600);
writeFileSync(`${base}-reasons.json`, JSON.stringify(Object.fromEntries(ids.map((id) => [id, review.get(id)])), null, 1), { mode: 0o600 }); chmodSync(`${base}-reasons.json`, 0o600);
const inYes = ids.filter((id) => yesIds.includes(id)).length;
console.log(`\nreview list: ${ids.length} messages = ${yesIds.length} Yes + ${noSample.length} sampled No + ${ids.filter((id) => flagged.has(id) && !yesIds.includes(id) && !noSample.includes(id)).length} further flagged (some flagged ones are also Yes/No picks; ${inYes} Yes)`);
console.log(`ids: ${base}-ids.txt   reasons (no content): ${base}-reasons.json`);
process.exit(0);
