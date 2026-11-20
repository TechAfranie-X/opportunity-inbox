// Read-only probe: for given Gmail message ids, prints ONLY booleans describing why the closure fact did or did not fire. No text is printed or stored.
// Usage: probe-closure.ts <googleSub> <id> [<id> ...]
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { closureDiagnose, closureFact, marketingFact } from "../lib/reliability/evidence.ts";
const token = await refreshGmailAccessToken((await getGmailRefreshToken(process.argv[2]))!);
const { emails } = await fetchEmailsById(token, process.argv.slice(3));
for (const m of emails) console.log(m.id, m.receivedAt.toISOString().slice(0, 10), `words=${m.bodyText.split(/\s+/).length}`, JSON.stringify(closureDiagnose(m)), `fact=${closureFact(m)}`, `marketing=${marketingFact(m)}`);
process.exit(0);
