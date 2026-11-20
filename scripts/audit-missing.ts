// Read-only diagnosis of a "missing application": for a Gmail search, shows per message whether discovery lists it, whether it is stored (as an event or as an evaluated
// prediction) and what the CURRENT reader would make of it. Prints headers and decisions only, never a message body. Gmail is read-only.
// Usage: audit-missing.ts <googleSub> "<gmail query>" [--max 15]
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { eventPredictions, recruitingEvents } from "../lib/db/schema.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { RECRUITING_QUERY, fetchEmailsById, listMessageRefs } from "../lib/gmail/recruiting-source.ts";
import { SWEEP_QUERY } from "../lib/discovery/strategy.ts";
import { readMail } from "../lib/reliability/assess.ts";

const sub = process.argv[2], query = process.argv[3];
const max = Number(process.argv[process.argv.indexOf("--max") + 1]) || 15;
const refresh = await getGmailRefreshToken(sub);
if (!refresh) throw new Error("not connected");
const token = await refreshGmailAccessToken(refresh);
const refs = await listMessageRefs(token, max, query);
const ids = refs.map((r) => r.id);
const inKeyword = new Set((await listMessageRefs(token, 4000, RECRUITING_QUERY)).map((r) => r.id));
const inSweep = new Set((await listMessageRefs(token, 4000, SWEEP_QUERY)).map((r) => r.id));
const db = getDb();
const ev = new Set((await db.select({ id: recruitingEvents.gmailMessageId }).from(recruitingEvents).where(and(eq(recruitingEvents.userGoogleSub, sub), inArray(recruitingEvents.gmailMessageId, ids)))).map((r) => r.id));
const pred = new Map((await db.select({ id: eventPredictions.gmailMessageId, d: eventPredictions.decision }).from(eventPredictions).where(and(eq(eventPredictions.userGoogleSub, sub), inArray(eventPredictions.gmailMessageId, ids)))).map((r) => [r.id, r.d] as const));
const { emails } = await fetchEmailsById(token, ids);
const read = new Map(readMail(emails).map((e) => [e.gmailMessageId, e] as const));
for (const m of emails) {
  const e = read.get(m.id);
  console.log(`${m.receivedAt.toISOString().slice(0, 10)} ${m.outbound ? "OUT" : "IN "} keyword=${inKeyword.has(m.id) ? "Y" : "n"} sweep=${inSweep.has(m.id) ? "Y" : "n"} stored=${ev.has(m.id) ? "event" : pred.has(m.id) ? `pred:${pred.get(m.id)}` : "-"} | now-reads=${e ? `${e.type}${e.signals.includes("near-miss") ? "(near-miss)" : ""} co=${e.company}` : "nothing"} | ${m.from.slice(0, 40)} | ${m.subject.slice(0, 60)}`);
}
process.exit(0);
