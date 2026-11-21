/**
 * READ-ONLY verification against real Gmail: for the active opportunities that exist only because the model said so, fetch the message and print the deterministic facts about its text plus
 * a short subject, so a person can judge which are real applications. Nothing is stored or written. node ... scripts/verify-model-only.ts <googleSub>
 */
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { factClaims } from "../lib/ledger/build.ts";
import { senderIsEmployer } from "../lib/identity/represented-employer.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
const sub = process.argv[2];
const ws = await loadWorkspace(sub, new Date());
const targets = ws.opportunities.filter((o) => o.status === "active" && (o.kind ?? "job") === "job" && o.events.filter((e) => !e.outbound).some((e) => !e.signals.includes("semantic:event") && !e.signals.includes("near-miss")) && o.events.filter((x) => !x.outbound).length === 1).map((o) => ({ o, e: o.events.filter((x) => !x.outbound)[0] }));
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const byId = new Map<string, Awaited<ReturnType<typeof fetchEmailsById>>["emails"][number]>();
for (let i = 0; i < targets.length; i += 20) { const { emails } = await fetchEmailsById(token, targets.slice(i, i + 20).map((t) => t.e.gmailMessageId)); for (const m of emails) byId.set(m.id, m); }
for (const { o, e } of targets) {
  const m = byId.get(e.gmailMessageId);
  if (!m) { console.log(`${(o.company ?? "").slice(0, 26).padEnd(26)}|${e.type.padEnd(18)}| (message not fetched)`); continue; }
  const f = new Set(factClaims(m).map((c) => c.value));
  const flags = ["own_process_wording", "closure_wording", "explicit_offer", "marketing_alert", "marketing_bulk", "not_own_process"].filter((x) => f.has(x as never)).map((x) => x.replace("_wording", "").replace("own_process", "own").replace("marketing_", "mk-").replace("not_own_process", "NOTMINE")).join(",");
  console.log(`${o.company.slice(0, 26).padEnd(26)}|${e.type.padEnd(18)}|${e.senderDomain.slice(0, 26).padEnd(26)}|${senderIsEmployer(o.company, e.senderDomain) ? "SELF" : "3RD "}|${flags.padEnd(22)}|${m.subject.slice(0, 58)}`);
}
process.exit(0);
