/**
 * READ-ONLY verification against real Gmail of the consequential events (offers, rejections, withdrawals, dated interviews and assessments). Fetches each message and prints the deterministic
 * facts about its text, whether the stored date really occurs in it, and a short subject. Nothing is stored or written. node ... scripts/verify-consequential.ts <googleSub> <types,comma>
 */
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { findDateMentions } from "../lib/recruiting/dates.ts";
import { factClaims } from "../lib/ledger/build.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
const sub = process.argv[2], types = new Set((process.argv[3] ?? "offer,rejection").split(","));
const ws = await loadWorkspace(sub, new Date());
const targets = ws.opportunities.flatMap((o) => o.events.filter((e) => !e.outbound && types.has(e.type) && !e.signals.includes("near-miss")).map((e) => ({ o, e })));
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const byId = new Map<string, Awaited<ReturnType<typeof fetchEmailsById>>["emails"][number]>();
for (let i = 0; i < targets.length; i += 20) { const { emails } = await fetchEmailsById(token, targets.slice(i, i + 20).map((t) => t.e.gmailMessageId)); for (const m of emails) byId.set(m.id, m); }
const day = (d: Date) => d.toISOString().slice(0, 10);
for (const { o, e } of targets) {
  const m = byId.get(e.gmailMessageId);
  if (!m) { console.log(`${o.company.slice(0, 22).padEnd(22)}|${e.type.padEnd(17)}| (not fetched)`); continue; }
  const f = new Set(factClaims(m).map((c) => c.value));
  const flags = ["closure_wording", "explicit_offer", "own_process_wording", "marketing_alert", "marketing_bulk", "not_own_process"].filter((x) => f.has(x as never)).map((x) => ({ closure_wording: "CLOSE", explicit_offer: "OFFER", own_process_wording: "own", marketing_alert: "mk-alert", marketing_bulk: "mk-bulk", not_own_process: "NOTMINE" }[x])).join(",");
  let dateCheck = "-";
  if (e.eventDate) { const found = findDateMentions(`${m.subject}\n${m.bodyText}`, m.receivedAt).some((d) => (d as { date?: Date }).date && day((d as { date: Date }).date) === day(e.eventDate!)); dateCheck = found ? "date-ok" : "DATE?"; }
  console.log(`${o.company.slice(0, 22).padEnd(22)}|${e.type.padEnd(17)}|${(e.signals.includes("semantic:event") ? "model" : "rule ").padEnd(5)}|${flags.padEnd(16)}|${dateCheck.padEnd(7)}|${m.subject.slice(0, 56)}`);
}
process.exit(0);
