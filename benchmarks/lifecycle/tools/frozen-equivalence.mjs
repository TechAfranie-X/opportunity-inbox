#!/usr/bin/env node
/**
 * Re-runs the frozen-reference equivalence check: exports the freeze tag with `git archive` into a scratch directory (nothing in the repository, the tag or any
 * store is modified), runs the rule reader from the tag and from this checkout over the DEVELOPMENT mailbox (dev datasets only; BLIND is never read), and reports how
 * many events differ in any field (the `contact:` hash signal added by the product is ignored). Aggregates only.
 *   node benchmarks/lifecycle/tools/frozen-equivalence.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const TAG = "arch-v2-shadow-candidate-2";
const scratch = mkdtempSync(join(tmpdir(), "oi-frozen-"));
try {
  const tar = execFileSync("git", ["-C", repo, "archive", TAG, "lib", "scripts/loader", "package.json", "tsconfig.json"], { maxBuffer: 1 << 28 });
  execFileSync("tar", ["-x", "-C", scratch], { input: tar });
  symlinkSync(join(repo, "node_modules"), join(scratch, "node_modules"));
  const dump = join(scratch, "dump.ts");
  writeFileSync(dump, `
import { readFileSync, writeFileSync } from "node:fs"; import { homedir } from "node:os"; import { join } from "node:path";
const tree = process.argv[2], out = process.argv[3];
const { extractAll } = await import(join(tree, "lib/recruiting/extract.ts"));
const root = join(homedir(), ".opportunity-inbox", "eval"); const rows = {};
for (const ds of ["dev-random-1", "validation-1", "validation-2"]) {
  const members = new Set(JSON.parse(readFileSync(join(root, ds, "manifest.json"), "utf8")).memberIds);
  const msgs = readFileSync(join(root, ds, "messages.jsonl"), "utf8").split("\\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => members.has(m.id)).map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) }));
  for (const e of extractAll(msgs)) rows[ds + "|" + e.gmailMessageId] = { type: e.type, company: e.company, role: e.role, date: e.eventDate?.toISOString() ?? null, kind: e.dateKind, time: e.eventDateHasTime, conf: e.confidence, fc: e.fieldConfidence, outbound: e.outbound, signals: e.signals.filter((s) => !s.startsWith("contact:")), reasons: e.reviewReasons };
}
writeFileSync(out, JSON.stringify(rows));`);
  const runIn = (tree, out) => execFileSync("node", ["--no-warnings", "--import", join(tree, "scripts/loader/register.mjs"), dump, tree, out], { stdio: ["ignore", "ignore", "inherit"] });
  runIn(scratch, join(scratch, "frozen.json"));
  runIn(repo, join(scratch, "current.json"));
  const a = JSON.parse(readFileSync(join(scratch, "frozen.json"), "utf8")), b = JSON.parse(readFileSync(join(scratch, "current.json"), "utf8"));
  const fields = ["type", "company", "role", "date", "kind", "time", "conf", "fc", "outbound", "signals", "reasons"];
  const diff = {}; let differing = 0;
  for (const k of Object.keys(a)) if (k in b) { let d = false; for (const f of fields) if (JSON.stringify(a[k][f]) !== JSON.stringify(b[k][f])) { diff[f] = (diff[f] ?? 0) + 1; d = true; } if (d) differing++; }
  console.log(`frozen ${Object.keys(a).length} events, current ${Object.keys(b).length}; only in frozen ${Object.keys(a).filter((k) => !(k in b)).length}, only in current ${Object.keys(b).filter((k) => !(k in a)).length}; events differing in any field: ${differing} ${differing ? JSON.stringify(diff) : ""}`);
  process.exitCode = differing || Object.keys(a).length !== Object.keys(b).length ? 1 : 0;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
