/**
 * Stamps stored events with the deterministic message facts (class:event|survey|notice|community|program-acceptance, ending:wording) computed from the REAL message by the same function that
 * reads new mail (lib/reliability/evidence-signals.ts). Read-only on Gmail, no model, no full-mailbox scan: only stored events are fetched. Only rows with no correction/confirmation/ignore are
 * touched; signals are appended; a local backup maps id to what was added; --rollback removes exactly that.
 *   node ... scripts/stamp-message-evidence.ts <googleSub> [--apply | --rollback <backup>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { evidenceSignals } from "../lib/reliability/evidence-signals.ts";
const sub = process.argv[2]; const apply = process.argv.includes("--apply"); const rb = process.argv.includes("--rollback") ? process.argv[process.argv.indexOf("--rollback") + 1] : null;
const rowsOf = (res: unknown) => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, unknown>[];
const db = getDb();
if (rb) {
  const back = JSON.parse(readFileSync(rb, "utf8")) as Record<string, string[]>;
  for (const [id, added] of Object.entries(back)) for (const sig of added) await db.execute(sql`update recruiting_events set signals = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(signals) x where x <> to_jsonb(${sig}::text)) where id = ${id}::uuid and user_google_sub = ${sub} and correction is null`);
  console.log(`rolled back ${Object.keys(back).length} rows`); process.exit(0);
}
const rows = rowsOf(await db.execute(sql`select id::text, gmail_message_id, type, signals, company from recruiting_events where user_google_sub = ${sub} and outbound = false and correction is null and signals::text not like '%near-miss%'`));
const emails = [];
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
for (let i = 0; i < rows.length; i += 20) emails.push(...(await fetchEmailsById(token, rows.slice(i, i + 20).map((r) => r.gmail_message_id as string))).emails);
const by = new Map(emails.map((m) => [m.id, m]));
const plan: Record<string, string[]> = {}; const tally: Record<string, number> = {}; const names: Record<string, Set<string>> = {};
for (const r of rows) {
  const m = by.get(r.gmail_message_id as string); if (!m) continue;
  const add = evidenceSignals(m, { type: r.type as never, signals: r.signals as string[], outbound: false });
  if (add.length === 0) continue;
  plan[r.id as string] = add; for (const a of add) { tally[a] = (tally[a] ?? 0) + 1; (names[a] ??= new Set()).add(String(r.company).slice(0, 18)); }
}
console.log(`${rows.length} uncorrected stored events read; ${Object.keys(plan).length} get a signal:`, JSON.stringify(tally));
for (const [k, v] of Object.entries(names)) console.log(`  ${k}: ${[...v].slice(0, 14).join(", ")}`);
if (!apply) { console.log("dry run: nothing changed (add --apply)"); process.exit(0); }
const dir = `${homedir()}/.opportunity-inbox-sealed`; mkdirSync(dir, { recursive: true });
const file = `${dir}/stamp-evidence-${sub.slice(0, 6)}-${Date.now()}.json`; writeFileSync(file, JSON.stringify(plan));
for (const [id, add] of Object.entries(plan)) await db.execute(sql`update recruiting_events set signals = signals || ${JSON.stringify(add)}::jsonb where id = ${id}::uuid and user_google_sub = ${sub} and correction is null`);
console.log(`applied; backup ${file}; rollback: --rollback ${file}`);
process.exit(0);
