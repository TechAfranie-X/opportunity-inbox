// Read-only: how much of the Gmail search results has the product actually evaluated? Usage: audit-coverage.ts <googleSub>
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { eventPredictions, recruitingEvents } from "../lib/db/schema.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { RECRUITING_QUERY, listMessageRefs } from "../lib/gmail/recruiting-source.ts";
import { SWEEP_QUERY } from "../lib/discovery/strategy.ts";
const sub = process.argv[2];
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const kw = (await listMessageRefs(token, 4000, RECRUITING_QUERY)).map((r) => r.id);
const sw = (await listMessageRefs(token, 4000, SWEEP_QUERY)).map((r) => r.id);
const db = getDb();
const ev = new Set((await db.select({ id: recruitingEvents.gmailMessageId }).from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, sub))).map((r) => r.id));
const pr = new Set((await db.select({ id: eventPredictions.gmailMessageId }).from(eventPredictions).where(eq(eventPredictions.userGoogleSub, sub))).map((r) => r.id));
const done = (id: string) => ev.has(id) || pr.has(id);
console.log({ keywordListed: kw.length, keywordUnevaluated: kw.filter((i) => !done(i)).length, sweepListed: sw.length, sweepUnevaluated: sw.filter((i) => !done(i)).length, events: ev.size, predictions: pr.size });
process.exit(0);
