/**
 * Corrected-row repair (docs/phase2-identity-lifecycle.md). Requires the owner's approval to change anything.
 *   plan     --out <file>                      read-only; writes the full plan (previous values included) to <file>, which must be OUTSIDE the repository; prints only counts, ids and hashes
 *   apply    --plan <file> --approve <token>   the token is the plan's fingerprint printed by `plan`; the owner supplies it, nothing else works
 *   rollback --plan <file> --approve <token>
 * Never run implicitly. Refuses any database whose name is not scratch_* unless --real is given.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPlan, buildPlan, planFingerprint, rollbackPlan, type RepairPlan } from "../lib/recruiting/repair-inherited-roles.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const [mode] = process.argv.slice(2);
const dbName = new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname.slice(1);
if ((mode === "apply" || mode === "rollback") && !dbName.startsWith("scratch_") && !process.argv.includes("--real")) { console.error(`refusing to ${mode} on ${dbName}: pass --real only with the owner's approval`); process.exit(2); }
if (mode === "plan") {
  const out = arg("--out");
  if (!out) { console.error("--out <file outside the repository> is required"); process.exit(2); }
  if (resolve(out).startsWith(resolve("."))) { console.error("the plan holds previous values; it must be written outside the repository"); process.exit(2); }
  const plan = await buildPlan((arg("--restore-xmins") ?? "5215,5216").split(","));
  writeFileSync(out, JSON.stringify(plan, null, 1));
  console.log(`plan: ${plan.rows.length} rows to repair, ${plan.excluded.length} listed but excluded; fingerprint ${planFingerprint(plan)}; written to ${out}`);
  for (const r of plan.rows) console.log(`  ${r.id}  account ${r.account}  version ${r.xminBefore}  columns: role, field_confidence.role, signals(-role-inherited)`);
  for (const e of plan.excluded) console.log(`  EXCLUDED ${e.id}: ${e.reason.slice(0, 90)}`);
  process.exit(0);
}
if (mode === "apply" || mode === "rollback") {
  const plan = JSON.parse(readFileSync(arg("--plan") ?? "", "utf8")) as RepairPlan;
  try { console.log(JSON.stringify(mode === "apply" ? await applyPlan(plan, arg("--approve") ?? "") : await rollbackPlan(plan, arg("--approve") ?? ""))); process.exit(0); }
  catch (e) { console.error((e as Error).message); process.exit(1); }
}
console.error("usage: repair-inherited-roles.ts plan|apply|rollback"); process.exit(2);
