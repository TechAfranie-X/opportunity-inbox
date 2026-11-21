/** READ-ONLY: lists stored events (and their real subjects, fetched from Gmail) for chosen employers, to help a person define validation journeys. Prints short labels only; nothing is stored. node ... scripts/validation-candidates.ts <sub> <regex> */
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
process.env.ENTRY_POLICY = "off";
const sub = process.argv[2], re = new RegExp(process.argv[3], "i");
const ws = await loadWorkspace(sub, new Date());
const opps = ws.opportunities.filter((o) => re.test(o.company));
const ids = opps.flatMap((o) => o.events.filter((e) => !e.outbound).map((e) => e.gmailMessageId));
const { emails } = await fetchEmailsById(await refreshGmailAccessToken((await getGmailRefreshToken(sub))!), ids);
const by = new Map(emails.map((m) => [m.id, m]));
for (const o of opps) {
  console.log(`## ${o.company} | ${(o.role ?? "-").slice(0, 40)} | ${o.status}/${o.stage} | key ${o.key.slice(-10)}`);
  for (const e of o.events.filter((x) => !x.outbound)) console.log(`   ${e.gmailMessageId.slice(0, 8)} ${e.occurredAt.toISOString().slice(2, 10)} ${e.type.padEnd(17)}${e.signals.includes("semantic:event") ? "M" : " "} ${e.senderDomain.slice(0, 22).padEnd(22)} ${(by.get(e.gmailMessageId)?.subject ?? "?").slice(0, 62)}`);
}
process.exit(0);
