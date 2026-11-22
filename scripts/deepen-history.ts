/**
 * History deepening. The mailbox search looks back 365 days, so an application that STARTED just before that window (a receipt in October, an interview in November, a rejection that arrives
 * after the window opens) loses its beginning: the journey is incomplete, or absent when everything it holds is older. For every employer the student already has evidence for inside the window
 * whose earliest in-window message is within 150 days of the window's start, this asks Gmail (read-only) for that employer's older mail (its non-shared sender domains, else its name), reads it with the
 * product's own rule reader (no model), and keeps ONLY events whose employer is that employer. Dry-run by default; --apply inserts new rows (onConflictDoNothing) and writes the inserted ids;
 * --rollback <file> deletes exactly those (never a corrected row). Nothing is restamped.
 *   node ... scripts/deepen-history.ts <googleSub> [--apply | --rollback <file>] [--days 270]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { recruitingEvents } from "../lib/db/schema.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById, listMessageRefs } from "../lib/gmail/recruiting-source.ts";
import { readMail } from "../lib/reliability/assess.ts";
import { evidenceSignals } from "../lib/reliability/evidence-signals.ts";
import { companyKey } from "../lib/recruiting/company.ts";
const sub = process.argv[2]; const apply = process.argv.includes("--apply"); const rb = process.argv.includes("--rollback") ? process.argv[process.argv.indexOf("--rollback") + 1] : null;
const back = Number(process.argv.includes("--days") ? process.argv[process.argv.indexOf("--days") + 1] : 270);
const db = getDb(); const dir = `${homedir()}/.opportunity-inbox-sealed`;
if (rb) { const ids = JSON.parse(readFileSync(rb, "utf8")) as string[]; await db.delete(recruitingEvents).where(and(eq(recruitingEvents.userGoogleSub, sub), inArray(recruitingEvents.gmailMessageId, ids), isNull(recruitingEvents.correction))); console.log(`rolled back ${ids.length} rows`); process.exit(0); }
const SHARED = /(?:^|\.)(?:gmail|googlemail|outlook|google|zoom|calendly|luma|lu\.ma|eventbrite|mailchimp|hubspot-?mail|typeform|slack|linkedin|handshake|ripplematch|getripplematch|greenhouse(?:-mail)?|lever|icims|workday|myworkday|myworkdayjobs|smartrecruiters|ashbyhq|jobvite|codesignal|hackerrank|hackerrankforwork|hirevue|codility|forage|theforage|github|extern|otter)\./i;
const rows = await db.select().from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, sub));
const stored = new Set(rows.map((r) => r.gmailMessageId));
const windowStart = new Date(Date.now() - 365 * 86_400_000);
const byEmployer = new Map<string, { name: string; first: Date; domains: Set<string> }>();
for (const r of rows) {
  if (r.outbound || !r.company || /^unknown/i.test(r.company)) continue;
  const k = companyKey(r.company); const cur = byEmployer.get(k) ?? { name: r.company, first: r.occurredAt, domains: new Set<string>() };
  if (r.occurredAt < cur.first) cur.first = r.occurredAt;
  if (r.senderDomain && !SHARED.test(`.${r.senderDomain}.`)) cur.domains.add(r.senderDomain);
  byEmployer.set(k, cur);
}
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const lo = new Date(windowStart.getTime() - back * 86_400_000);
const fmt = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
const out: { employer: string; id: string; type: string; subject: string }[] = []; const inserts: (typeof recruitingEvents.$inferInsert)[] = [];
for (const [key, emp] of byEmployer) {
  if (emp.first.getTime() - windowStart.getTime() > 150 * 86_400_000) continue;
  const who = emp.domains.size > 0 ? `(${[...emp.domains].map((d) => `from:${d}`).join(" OR ")})` : `"${emp.name}"`;
  const refs = await listMessageRefs(token, 60, `${who} after:${fmt(lo)} before:${fmt(windowStart)} -in:spam -in:trash -in:sent`);
  const fresh = refs.map((r: { id: string }) => r.id).filter((id: string) => !stored.has(id));
  if (fresh.length === 0) continue;
  const { emails } = await fetchEmailsById(token, fresh);
  for (const ev of readMail(emails)) {
    if (!ev.company || companyKey(ev.company) !== key) continue;
    // older mail is kept only when it states a STAGE of the process (a receipt, an assessment, an interview, an offer, an ending): plain updates and nudges say too little to rebuild a journey from
    if (["status_update", "follow_up", "recruiter_outreach", "user_reply"].includes(ev.type)) continue;
    const m = emails.find((x) => x.id === ev.gmailMessageId)!;
    const signals = [...ev.signals, ...evidenceSignals(m, { type: ev.type, signals: ev.signals, outbound: ev.outbound }), "recovered:deepen"];
    out.push({ employer: emp.name, id: ev.gmailMessageId, type: ev.type, subject: ev.subject.slice(0, 60) });
    inserts.push({ userGoogleSub: sub, gmailMessageId: ev.gmailMessageId, gmailThreadId: ev.gmailThreadId, occurredAt: ev.occurredAt, outbound: ev.outbound, senderName: ev.senderName, senderDomain: ev.senderDomain, subject: ev.subject, type: ev.type, company: ev.company, role: ev.role, eventDate: ev.eventDate, eventDateHasTime: ev.eventDateHasTime, dateKind: ev.dateKind, confidence: ev.confidence, fieldConfidence: ev.fieldConfidence, reviewReasons: ev.reviewReasons ?? [], signals } as never);
  }
}
const per = new Map<string, number>(); for (const o of out) per.set(o.employer, (per.get(o.employer) ?? 0) + 1);
for (const [e, n] of per) console.log(`${e.slice(0, 30).padEnd(30)} ${n} older messages: ${out.filter((o) => o.employer === e).map((o) => o.type).join(",")}`);
console.log(`${out.length} older events for ${per.size} employers${apply ? "" : " (dry run; --apply stores them)"}`);
if (apply && inserts.length) { mkdirSync(dir, { recursive: true }); const f = `${dir}/deepen-${sub.slice(0, 6)}-${Date.now()}.json`; writeFileSync(f, JSON.stringify(inserts.map((r) => r.gmailMessageId))); await db.insert(recruitingEvents).values(inserts as never).onConflictDoNothing(); console.log(`stored; rollback: --rollback ${f}`); }
process.exit(0);
