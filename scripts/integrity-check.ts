/**
 * Read-only integrity check for every row that carries a person's correction, confirmation or ignore.
 *
 *   node --env-file=.env.local --no-warnings --import ./scripts/loader/register.mjs scripts/integrity-check.ts snapshot <file>
 *   node --env-file=.env.local --no-warnings --import ./scripts/loader/register.mjs scripts/integrity-check.ts compare  <file>
 *
 * A snapshot lists, per corrected row: id | account | Postgres row version (xmin) | content digest (type, company, role, date, signals, correction). `compare` reports any row that
 * was rewritten (version changed), changed in content, removed, or newly corrected since the snapshot, and exits 1 if one was. It prints ids and digests only, never content.
 * Run it before and after any re-read, backfill, migration or release. A re-read must leave every line identical (docs/audit-remediation.md, integrity record).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";

type Row = { id: string; account: string; xmin: string; digest: string };

async function current(): Promise<Row[]> {
  const res = await getDb().execute(sql`select id::text as id, user_google_sub as account, xmin::text as xmin, type, company, role, event_date::text as event_date, signals::text as signals, correction::text as correction from recruiting_events where correction is not null order by id`);
  const rows = (Array.isArray(res) ? res : (res as unknown as { rows: unknown[] }).rows) as Record<string, string | null>[];
  return rows.map((r) => ({ id: r.id!, account: createHash("sha256").update(r.account ?? "").digest("hex").slice(0, 8), xmin: r.xmin!, digest: createHash("sha256").update(JSON.stringify([r.type, r.company, r.role, r.event_date, r.signals, r.correction])).digest("hex").slice(0, 16) }));
}
const line = (r: Row) => `${r.id}|${r.account}|${r.xmin}|${r.digest}`;
const parse = (t: string): Row[] => t.split("\n").filter(Boolean).map((l) => { const [id, account, xmin, digest] = l.split("|"); return { id, account, xmin, digest }; });

const [mode, file] = process.argv.slice(2);
if (!file || (mode !== "snapshot" && mode !== "compare")) { console.error("usage: integrity-check.ts snapshot|compare <file>"); process.exit(2); }
const now = await current();
if (mode === "snapshot") { writeFileSync(file, `${now.map(line).join("\n")}\n`); console.log(`snapshot: ${now.length} corrected rows -> ${file}`); process.exit(0); }
if (!existsSync(file)) { console.error(`no snapshot at ${file}`); process.exit(2); }
const before = new Map(parse(readFileSync(file, "utf8")).map((r) => [r.id, r]));
const after = new Map(now.map((r) => [r.id, r]));
const problems: string[] = [];
for (const [id, b] of before) {
  const a = after.get(id);
  if (!a) problems.push(`${id} REMOVED (or its correction was cleared)`);
  else if (a.digest !== b.digest) problems.push(`${id} CONTENT CHANGED (digest ${b.digest} -> ${a.digest}, version ${b.xmin} -> ${a.xmin})`);
  else if (a.xmin !== b.xmin) problems.push(`${id} REWRITTEN with identical content (version ${b.xmin} -> ${a.xmin})`);
}
for (const id of after.keys()) if (!before.has(id)) problems.push(`${id} NEWLY CORRECTED`);
console.log(`corrected rows: before ${before.size}, now ${after.size}`);
if (problems.length > 0) { for (const p of problems) console.log(`  - ${p}`); process.exit(1); }
console.log("INTEGRITY OK: every corrected row is untouched");
process.exit(0);
