/**
 * Mark stored MODEL-ONLY events that state the student's own application (and are not marketing or a notice) as corroborated (signal entry:corroborated), so a strong model-found application
 * enters the pipeline instead of waiting. Reads each message from Gmail (read-only), applies the same facts as the engine. Only rows with no correction/confirmation/ignore are touched; one signal
 * is appended; a local backup list is written and `--rollback` removes the signal from exactly those rows.
 *   node ... scripts/stamp-entry-evidence.ts <googleSub> [--apply | --rollback <backup>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { endingWording, marketingFact, ownApplicationStatement } from "../lib/reliability/evidence.ts";
import { explicitOffer } from "../lib/reliability/facts.ts";
import { notAProcess } from "../lib/semantic/assist.ts";
const sub = process.argv[2]; const apply = process.argv.includes("--apply"); const rb = process.argv.includes("--rollback") ? process.argv[process.argv.indexOf("--rollback") + 1] : null;
const rowsOf = (res: unknown) => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, string>[];
const db = getDb();
if (rb) {
  const ids = JSON.parse(readFileSync(rb, "utf8")) as string[];
  for (const id of ids) await db.execute(sql`update recruiting_events set signals = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(signals) x where x <> '"entry:corroborated"'::jsonb) where id = ${id}::uuid and user_google_sub = ${sub} and correction is null`);
  console.log(`rolled back ${ids.length} rows`); process.exit(0);
}
const rows = rowsOf(await db.execute(sql`select id::text, gmail_message_id, company, type from recruiting_events where user_google_sub = ${sub} and outbound = false and correction is null and signals::text like '%semantic:event%' and signals::text not like '%entry:corroborated%' and signals::text not like '%near-miss%'`));
const { emails } = await fetchEmailsById(await refreshGmailAccessToken((await getGmailRefreshToken(sub))!), rows.map((r) => r.gmail_message_id));
const by = new Map(emails.map((m) => [m.id, m]));
const yes = rows.filter((r) => { const m = by.get(r.gmail_message_id); return m && ownApplicationStatement(m) && !marketingFact(m) && !notAProcess(m) && (!(["offer", "rejection", "withdrawn"].includes(r.type)) || (r.type === "offer" ? explicitOffer(m) !== null : endingWording(m))); });
console.log(`${rows.length} uncorrected model-only events checked; ${yes.length} state the student's own application: ${[...new Set(yes.map((r) => r.company))].join(", ")}`);
if (!apply) { console.log("dry run: nothing changed (add --apply)"); process.exit(0); }
const dir = `${homedir()}/.opportunity-inbox-sealed`; mkdirSync(dir, { recursive: true });
const file = `${dir}/stamp-entry-${sub.slice(0, 6)}-${Date.now()}.json`; writeFileSync(file, JSON.stringify(yes.map((r) => r.id)));
for (const r of yes) await db.execute(sql`update recruiting_events set signals = signals || '["entry:corroborated"]'::jsonb where id = ${r.id}::uuid and user_google_sub = ${sub} and correction is null`);
console.log(`applied to ${yes.length} rows; backup ${file}; rollback: --rollback ${file}`);
process.exit(0);
