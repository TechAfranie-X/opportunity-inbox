/** READ-ONLY: prints the first 230 characters of the body of messages given by id PREFIX (resolved from the stored events), to help a person label them. Local display only. node ... scripts/peek-ids.ts <sub> <prefix...> */
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
const [sub, ...prefixes] = process.argv.slice(2);
const res = await getDb().execute(sql`select gmail_message_id from recruiting_events where user_google_sub = ${sub}`);
const all = ((Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { gmail_message_id: string }[]).map((r) => r.gmail_message_id);
const ids = prefixes.map((p) => all.find((x) => x.startsWith(p))).filter((x): x is string => !!x);
const { emails } = await fetchEmailsById(await refreshGmailAccessToken((await getGmailRefreshToken(sub))!), ids);
for (const m of emails) console.log(`${m.id.slice(0, 8)} | ${m.subject.slice(0, 50)} | ${m.bodyText.replace(/\s+/g, " ").replace(/^.{0,40}?(?:Hi|Hello|Dear)[^,]{0,40},?\s*/i, "").slice(0, 230)}`);
process.exit(0);
