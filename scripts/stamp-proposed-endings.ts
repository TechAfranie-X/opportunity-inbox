/**
 * Mark stored rule-found REJECTIONS that contain no ending sentence as "proposed" (signal terminal:proposed): the application stays active and visible instead of being closed by what is
 * usually a receipt typed as a rejection. Reads each message from Gmail (read-only) and applies the same test as the engine (lib/reliability/evidence.ts `endingWording`). Only rows with NO
 * correction, confirmation or ignore are touched, and only one signal is appended. A local backup list is written; `rollback` removes the signal from exactly those rows.
 *   node ... scripts/stamp-proposed-endings.ts <googleSub>              dry run (default): prints counts and company names, changes nothing
 *   node ... scripts/stamp-proposed-endings.ts <googleSub> --apply      writes
 *   node ... scripts/stamp-proposed-endings.ts <googleSub> --rollback <backup file>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { endingWording } from "../lib/reliability/evidence.ts";
const sub = process.argv[2]; const apply = process.argv.includes("--apply"); const rb = process.argv.includes("--rollback") ? process.argv[process.argv.indexOf("--rollback") + 1] : null;
const rowsOf = (res: unknown) => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, string>[];
const db = getDb();
if (rb) {
  const ids = JSON.parse(readFileSync(rb, "utf8")) as string[];
  for (const id of ids) await db.execute(sql`update recruiting_events set signals = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(signals) x where x <> '"terminal:proposed"'::jsonb) where id = ${id}::uuid and user_google_sub = ${sub} and correction is null`);
  console.log(`rolled back ${ids.length} rows`); process.exit(0);
}
const rows = rowsOf(await db.execute(sql`select id::text, gmail_message_id, company from recruiting_events where user_google_sub = ${sub} and type = 'rejection' and outbound = false and correction is null and signals::text not like '%near-miss%' and signals::text not like '%terminal:proposed%'`));
const { emails } = await fetchEmailsById(await refreshGmailAccessToken((await getGmailRefreshToken(sub))!), rows.map((r) => r.gmail_message_id));
const by = new Map(emails.map((m) => [m.id, m]));
const lacking = rows.filter((r) => { const m = by.get(r.gmail_message_id); return m && !endingWording(m); });
console.log(`${rows.length} uncorrected rule-found rejections checked; ${lacking.length} have no ending sentence: ${lacking.map((r) => r.company).join(", ")}`);
if (!apply) { console.log("dry run: nothing changed (add --apply)"); process.exit(0); }
const dir = `${homedir()}/.opportunity-inbox-sealed`; mkdirSync(dir, { recursive: true });
const file = `${dir}/stamp-proposed-${sub.slice(0, 6)}-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(lacking.map((r) => r.id)));
for (const r of lacking) await db.execute(sql`update recruiting_events set signals = signals || '["terminal:proposed"]'::jsonb where id = ${r.id}::uuid and user_google_sub = ${sub} and correction is null`);
console.log(`applied to ${lacking.length} rows; backup list ${file}; rollback: --rollback ${file}`);
process.exit(0);
