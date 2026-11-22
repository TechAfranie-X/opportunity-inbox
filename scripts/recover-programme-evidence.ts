/**
 * Evidence recovery for programme and scholarship journeys that are open (applied / accepted / enrolled / participating). The sweep reads a programme host's mail and, when the rule reader finds no recruiting language
 * (a coursework reminder, a quiz deadline, a certificate notice), remembers it by id alone: the journey never sees it. This asks Gmail (read-only) for the host's mail since the journey began, keeps
 * only messages that name the programme in their own words (>= 60% of its name words) and are not campaigns/notices, and stores them as programme evidence (a plain update, with a deadline when the
 * message states one). Dry-run by default; --apply inserts and writes a backup of the inserted message ids (rollback: --rollback <file> deletes exactly those rows). No restamp of anything else.
 *   node ... scripts/recover-programme-evidence.ts <googleSub> [--apply | --rollback <file>]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { recruitingEvents } from "../lib/db/schema.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById, listMessageRefs } from "../lib/gmail/recruiting-source.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { pickDate } from "../lib/recruiting/dates.ts";
import { messageClass } from "../lib/reliability/message-class.ts";
import { campaignFact, marketingFact } from "../lib/reliability/evidence.ts";
import { evidenceSignals } from "../lib/reliability/evidence-signals.ts";
const sub = process.argv[2]; const apply = process.argv.includes("--apply"); const rb = process.argv.includes("--rollback") ? process.argv[process.argv.indexOf("--rollback") + 1] : null;
const db = getDb();
const dir = `${homedir()}/.opportunity-inbox-sealed`;
if (rb) { const ids = JSON.parse(readFileSync(rb, "utf8")) as string[]; await db.delete(recruitingEvents).where(and(eq(recruitingEvents.userGoogleSub, sub), inArray(recruitingEvents.gmailMessageId, ids), isNull(recruitingEvents.correction))); console.log(`rolled back ${ids.length} rows`); process.exit(0); }
const SHARED = /(?:^|\.)(?:gmail|googlemail|outlook|google|zoom|calendly|luma|lu\.ma|eventbrite|mailchimp|hubspot|typeform|slack|linkedin|handshake|greenhouse(?:-mail)?|lever|icims|workday|myworkday|smartrecruiters|ashbyhq|codesignal|hackerrank|hirevue)\./i;
const toks = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !["the", "and", "program", "programme", "for", "with", "fall", "spring", "summer", "winter"].includes(w) && !/^20\d\d$/.test(w)));
const ws = await loadWorkspace(sub, new Date());
const stored = new Set((await db.select({ id: recruitingEvents.gmailMessageId }).from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, sub))).map((r) => r.id));
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const best = new Map<string, { ratio: number; journey: string; tie: boolean }>();
const plan: { journey: string; id: string; subject: string; deadline: string | null }[] = []; const rows: (typeof recruitingEvents.$inferInsert)[] = [];
for (const o of ws.opportunities.filter((x) => x.kind && x.kind !== "job" && x.status === "active" && ["applied", "accepted", "enrolled", "participating"].includes(x.programState ?? "") && (x.role || x.company))) {
  const domains = [...new Set(o.events.filter((e) => !e.outbound && e.senderDomain && !SHARED.test(`.${e.senderDomain}.`)).map((e) => e.senderDomain))];
  const name = toks(o.role ?? o.company); if (name.size < 2) continue;
  const first = new Date(Math.min(...o.events.map((e) => e.occurredAt.getTime())) - 7 * 86_400_000);
  for (const d of domains) {
    const refs = await listMessageRefs(token, 100, `from:${d} after:${first.getFullYear()}/${first.getMonth() + 1}/${first.getDate()} -in:spam -in:trash -in:sent`);
    const fresh = refs.map((r: { id: string }) => r.id).filter((id: string) => !stored.has(id));
    if (fresh.length === 0) continue;
    const { emails } = await fetchEmailsById(token, fresh);
    for (const m of emails) {
      const cls = messageClass(m);
      // newsletters, digests and campaigns are not the programme's own mail
      if (cls === "marketing" || cls === "notice" || campaignFact(m) || marketingFact(m) || /\b(?:newsletter|mile post|resources (?:&|and) opportunities|webinar|new free courses)\b/i.test(m.subject)) continue;
      const hay = toks(`${m.subject} ${m.bodyText.slice(0, 2000)}`);
      const ratio = [...name].filter((t) => hay.has(t)).length / name.size;
      if (ratio < 0.6) continue;
      // a message goes to the ONE programme it names best; a tie between programmes is not guessed
      const key = `${o.company}|${o.role}`; const prev = best.get(m.id);
      if (!prev || ratio > prev.ratio) best.set(m.id, { ratio, journey: key, tie: false }); else if (ratio === prev.ratio && prev.journey !== key) prev.tie = true;
      if (prev && (ratio < prev.ratio || (ratio === prev.ratio && prev.journey !== key))) continue;
      const dl = pickDate(`${m.subject}\n${m.bodyText.slice(0, 1500)}`, m.receivedAt, "deadline");
      const hasDeadline = !!dl && /\b(?:by|due|deadline|before|no later than|complete)\b/i.test(`${m.subject} ${m.bodyText.slice(0, 600)}`);
      const sigs = [...evidenceSignals(m, { type: "status_update", signals: [], outbound: false }), "recovered:programme-evidence", `program:evidence:${o.events[0].gmailMessageId.slice(0, 8)}`];
      plan.push({ journey: `${o.company} | ${o.role}`, id: m.id, subject: m.subject.slice(0, 70), deadline: hasDeadline ? dl!.date.toISOString().slice(0, 10) : null });
      rows.push({ userGoogleSub: sub, gmailMessageId: m.id, gmailThreadId: m.threadId, occurredAt: m.receivedAt, outbound: false, senderName: m.from.replace(/<.*$/, "").trim().slice(0, 80), senderDomain: d, subject: m.subject, type: "status_update", company: o.company, role: o.role, eventDate: hasDeadline ? dl!.date : null, eventDateHasTime: hasDeadline ? dl!.hasTime : false, dateKind: hasDeadline ? "deadline" : null, confidence: 0.8, fieldConfidence: { type: 0.8, company: 0.9, role: 0.9 }, reviewReasons: [], signals: sigs } as never);
    }
  }
}
const keep = (journey: string, id: string) => { const b = best.get(id); return !!b && !b.tie && b.journey === journey.replace(" | ", "|"); };
for (let i = plan.length - 1; i >= 0; i--) if (!keep(plan[i].journey, plan[i].id)) { plan.splice(i, 1); rows.splice(i, 1); }
for (const p of plan) console.log(`${p.id.slice(0, 8)} ${p.journey.slice(0, 50)} | ${p.subject} | deadline ${p.deadline ?? "-"}`);
console.log(`${plan.length} messages would be recovered${apply ? "" : " (dry run; --apply stores them)"}`);
if (apply && rows.length) { mkdirSync(dir, { recursive: true }); const f = `${dir}/recover-programme-${sub.slice(0, 6)}-${Date.now()}.json`; writeFileSync(f, JSON.stringify(rows.map((r) => r.gmailMessageId))); await db.insert(recruitingEvents).values(rows as never).onConflictDoNothing(); console.log(`stored; rollback: --rollback ${f}`); }
process.exit(0);
