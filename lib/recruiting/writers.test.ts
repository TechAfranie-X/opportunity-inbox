import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The write paths to `recruiting_events`, each reviewed against the rule "no automated path may change a row the person corrected, confirmed or ignored".
 * A NEW write path fails this test until someone adds it here with its justification, which is the point: the 2026-11-20 audit found a role-inheritance update
 * that had no such guard and rewrote 15 corrected rows. Person-initiated actions (edit, confirm, ignore, reset) and "delete my data" are deliberate.
 */
const REVIEWED: Record<string, { count: number; why: string }> = {
  "lib/recruiting/store.ts": { count: 9, why: "upsert (setWhere correction is null), prune (correction is null), inheritStoredRoles (correction is null, plus corrected rows skipped), and the person's own setEventCorrection / editEvent / ignore / confirm / reset, and delete-my-data" },
  "scripts/recover-programme-evidence.ts": { count: 2, why: "INSERT-only of NEW rows (onConflictDoNothing: an existing row, corrected or not, is never touched); its rollback deletes only the ids it inserted and only where correction is null" },
  "scripts/deepen-history.ts": { count: 2, why: "INSERT-only of NEW rows (onConflictDoNothing); its rollback deletes only the ids it inserted and only where correction is null" },
};
const WRITE = /\.(?:update|delete|insert)\(\s*recruitingEvents\s*\)/g;
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === ".next" || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
};

test("every write path to recruiting_events is reviewed", () => {
  const found: Record<string, number> = {};
  for (const dir of ["lib", "app", "scripts"]) for (const file of walk(dir)) {
    const n = (readFileSync(file, "utf8").match(WRITE) ?? []).length;
    if (n > 0) found[file] = n;
  }
  const expected = Object.fromEntries(Object.entries(REVIEWED).map(([k, v]) => [k, v.count]));
  assert.deepEqual(found, expected, "a write path to recruiting_events was added or removed: review it against the corrected-row rule, then update REVIEWED");
});

test("the unguarded-update bug stays fixed: inheritStoredRoles guards its write and skips corrected rows", () => {
  const src = readFileSync("lib/recruiting/store.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function inheritStoredRoles"), src.indexOf("export async function", src.indexOf("export async function inheritStoredRoles") + 10));
  assert.match(fn, /isNull\(recruitingEvents\.correction\)/, "the update must carry the correction guard");
  assert.match(fn, /vouched/, "corrected rows must be skipped");
});
