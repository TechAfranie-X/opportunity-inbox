import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/**
 * REPAIR PLAN for corrected rows that gained an inherited role (see docs/phase2-identity-lifecycle.md, section 1). Nothing here runs by itself:
 *   plan      read-only. Lists the rows, the exact columns, previous and proposed values (previous values are kept in the plan file and a backup table, never printed).
 *   apply     refuses without the approval token (the plan's own fingerprint, which only the owner supplies). One transaction. A pre-repair backup table is written first; every row is
 *             re-checked under a row lock against the plan; the person's correction column is verified unchanged; any mismatch aborts and rolls back everything.
 *   rollback  restores the backed-up values in one transaction, after checking that the rows are still in the repaired state.
 * Why the "before" value is known: inheritRoles (lib/recruiting/extract.ts) only fills an EMPTY role, sets the role confidence to 0.4 and appends "role-inherited". So before the rewrite the role was
 * empty, its confidence was 0 (every role-less uncorrected row has 0) and the signal was absent.
 */
export type PlanRow = { id: string; account: string; xminBefore: string; role: string; fieldConfidenceBefore: Record<string, number>; signalsBefore: string[]; correctionDigest: string; roleProposed: null; fieldConfidenceProposed: Record<string, number>; signalsProposed: string[] };
export type RepairPlan = { version: 1; createdAt: string; selection: string; rows: PlanRow[]; excluded: { id: string; reason: string }[] };

const MARK = "role-inherited";
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
export const planFingerprint = (p: RepairPlan) => createHash("sha256").update(JSON.stringify({ rows: p.rows.map((r) => [r.id, r.role, r.fieldConfidenceBefore, r.signalsBefore, r.correctionDigest]) })).digest("hex").slice(0, 12);

type Row = { id: string; account: string; xmin: string; role: string | null; field_confidence: Record<string, number> | null; signals: string[]; correction: Record<string, unknown> | null };
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? res : (res as { rows: Row[] }).rows) as Row[];

/** Read-only. `restoreXmins` are the row versions written by the owner's restore transaction: rows still at those versions carry the marker from BEFORE the audit window and are listed, not planned. */
export async function buildPlan(restoreXmins: string[]): Promise<RepairPlan> {
  const res = await getDb().execute(sql`select id::text, user_google_sub as account, xmin::text, role, field_confidence, signals, correction from recruiting_events where correction is not null and signals::text like ${"%" + MARK + "%"} order by id`);
  const rows: PlanRow[] = [], excluded: { id: string; reason: string }[] = [];
  for (const r of rowsOf(res)) {
    const sigs = r.signals ?? [];
    if (restoreXmins.includes(r.xmin)) { excluded.push({ id: r.id, reason: "carries the marker since before the audit window; the person may have vouched for a reading that already had the role. Owner decision." }); continue; }
    if (r.correction && Object.prototype.hasOwnProperty.call(r.correction, "role")) { excluded.push({ id: r.id, reason: "the person's correction names a role" }); continue; }
    if (!r.role || sigs.filter((s) => s === MARK).length !== 1 || (r.field_confidence?.role ?? -1) !== 0.4) { excluded.push({ id: r.id, reason: "does not match the exact shape inheritRoles produces" }); continue; }
    const last = sigs.lastIndexOf(MARK);
    rows.push({ id: r.id, account: createHash("sha256").update(r.account).digest("hex").slice(0, 8), xminBefore: r.xmin, role: r.role, fieldConfidenceBefore: r.field_confidence!, signalsBefore: sigs, correctionDigest: digest(r.correction), roleProposed: null, fieldConfidenceProposed: { ...r.field_confidence!, role: 0 }, signalsProposed: sigs.filter((_, i) => i !== last) });
  }
  return { version: 1, createdAt: new Date().toISOString(), selection: "correction IS NOT NULL AND signals contain role-inherited exactly once AND correction does not name a role AND role confidence = 0.4 AND row version is not the restore transaction's", rows, excluded };
}

export const BACKUP_TABLE = "corrected_row_repair_backup";

/** `approval` must equal the plan's fingerprint. Everything happens in ONE transaction; any failed check throws and nothing is changed. */
export async function applyPlan(plan: RepairPlan, approval: string): Promise<{ repaired: number }> {
  if (approval !== planFingerprint(plan)) throw new Error("refused: the approval token does not match this plan (the owner supplies the plan's fingerprint)");
  if (plan.rows.length === 0) throw new Error("refused: empty plan");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql.raw(`create table if not exists ${BACKUP_TABLE} (event_id uuid primary key, backed_up_at timestamptz not null default now(), role_before text, field_confidence_before jsonb, signals_before jsonb, correction_digest text not null, plan_fingerprint text not null)`));
    for (const r of plan.rows) {
      const cur = rowsOf(await tx.execute(sql`select id::text, user_google_sub as account, xmin::text, role, field_confidence, signals, correction from recruiting_events where id = ${r.id} for update`))[0];
      if (!cur) throw new Error(`abort: row ${r.id} no longer exists`);
      if (cur.role !== r.role || digest(cur.correction) !== r.correctionDigest || JSON.stringify(cur.signals) !== JSON.stringify(r.signalsBefore) || JSON.stringify(cur.field_confidence) !== JSON.stringify(r.fieldConfidenceBefore)) throw new Error(`abort: row ${r.id} changed since the plan was made`);
      await tx.execute(sql`insert into corrected_row_repair_backup (event_id, role_before, field_confidence_before, signals_before, correction_digest, plan_fingerprint) values (${r.id}, ${r.role}, ${JSON.stringify(r.fieldConfidenceBefore)}::jsonb, ${JSON.stringify(r.signalsBefore)}::jsonb, ${r.correctionDigest}, ${planFingerprint(plan)}) on conflict (event_id) do nothing`);
      const upd = await tx.execute(sql`update recruiting_events set role = null, field_confidence = ${JSON.stringify(r.fieldConfidenceProposed)}::jsonb, signals = ${JSON.stringify(r.signalsProposed)}::jsonb where id = ${r.id} and correction is not null and role = ${r.role}`);
      if (((upd as unknown as { count?: number }).count ?? 1) !== 1) throw new Error(`abort: row ${r.id} was not updated exactly once`);
      const after = rowsOf(await tx.execute(sql`select id::text, user_google_sub as account, xmin::text, role, field_confidence, signals, correction from recruiting_events where id = ${r.id}`))[0];
      if (digest(after.correction) !== r.correctionDigest || after.role !== null) throw new Error(`abort: verification failed for ${r.id}`);
    }
    return { repaired: plan.rows.length };
  });
}

/** Restore the backed-up values; only rows still in the repaired state are touched, and a row that was changed again since aborts the whole rollback. */
export async function rollbackPlan(plan: RepairPlan, approval: string): Promise<{ restored: number }> {
  if (approval !== planFingerprint(plan)) throw new Error("refused: the approval token does not match this plan");
  return getDb().transaction(async (tx) => {
    for (const r of plan.rows) {
      const b = rowsOf(await tx.execute(sql`select event_id::text as id, role_before as role, field_confidence_before as field_confidence, signals_before as signals, correction_digest from corrected_row_repair_backup where event_id = ${r.id}`))[0] as unknown as { role: string | null; field_confidence: Record<string, number>; signals: string[] } | undefined;
      if (!b) throw new Error(`abort: no backup for ${r.id}`);
      const cur = rowsOf(await tx.execute(sql`select id::text, user_google_sub as account, xmin::text, role, field_confidence, signals, correction from recruiting_events where id = ${r.id} for update`))[0];
      if (cur.role !== null || JSON.stringify(cur.signals) !== JSON.stringify(r.signalsProposed) || digest(cur.correction) !== r.correctionDigest) throw new Error(`abort: row ${r.id} is no longer in the repaired state`);
      await tx.execute(sql`update recruiting_events set role = ${b.role}, field_confidence = ${JSON.stringify(b.field_confidence)}::jsonb, signals = ${JSON.stringify(b.signals)}::jsonb where id = ${r.id}`);
    }
    return { restored: plan.rows.length };
  });
}
