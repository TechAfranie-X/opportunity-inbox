// Read-only probe: reads given Gmail message ids with the product's rule reader and prints ONLY type/company/role and signal names. No text is printed or stored.
// Usage: probe-read.ts <googleSub> <id> [<id> ...]
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { readMail } from "../lib/reliability/assess.ts";
const token = await refreshGmailAccessToken((await getGmailRefreshToken(process.argv[2]))!);
const { emails } = await fetchEmailsById(token, process.argv.slice(3));
for (const e of readMail(emails)) console.log(e.gmailMessageId.slice(0, 8), e.type, e.company, e.role, e.signals.join(","));
for (const m of emails) if (!readMail([m]).length) console.log(m.id.slice(0, 8), "no event from rules");
process.exit(0);
