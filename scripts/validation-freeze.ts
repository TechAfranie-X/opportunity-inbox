/**
 * Freezes the private validation set and builds the reviewer's sheet.
 *   node ... scripts/validation-freeze.ts <googleSub>
 * Reads ~/.opportunity-inbox-validation/spec-<acct>.json (journeys and negatives by message-id prefix), resolves each to the stored message id, writes validation-v1.json (ids and labels only, no
 * message text) and records ONLY its sha256 in docs/validation-set.sha256, so any later change to the labels is detectable. Also writes review.html: one row per message with a Gmail link, the label,
 * and Agree / Disagree / Unsure buttons that export a verdicts file; scripts/validation-resolve.ts then lists only the disputes for the owner.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
const sub = process.argv[2]; const dir = `${homedir()}/.opportunity-inbox-validation`;
const spec = JSON.parse(readFileSync(`${dir}/spec-${sub.slice(0, 6)}.json`, "utf8")) as { journeys: { id: string; label: string; cycle: string; kind: string; status: string; outcome: string | null; msgs: string[] }[]; negatives: string[]; labeler: string; note: string };
const res = await getDb().execute(sql`select gmail_message_id, gmail_email from recruiting_events e, gmail_connections c where e.user_google_sub = ${sub} and c.user_google_sub = ${sub}`);
const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { gmail_message_id: string; gmail_email: string }[];
const all = [...new Set(rows.map((r) => r.gmail_message_id))]; const email = rows[0]?.gmail_email ?? "";
const resolve = (p: string) => { const m = all.filter((x) => x.startsWith(p)); if (m.length !== 1) throw new Error(`prefix ${p} resolves to ${m.length} stored messages`); return m[0]; };
const items: { id: string; journey: string | null; application: boolean; expect: string; tag: string; note?: string }[] = [];
const journeys = spec.journeys.map((j) => ({ id: j.id, label: j.label, cycle: j.cycle, kind: j.kind, status: j.status, outcome: j.outcome, messages: j.msgs.map((m) => { const [p, type, tag] = m.split(":"); const id = resolve(p); items.push({ id, journey: j.id, application: type !== "none" || true, expect: type, tag: tag ?? "clear" }); return id; }) }));
for (const n of spec.negatives) { const [p, ...note] = n.split(":"); items.push({ id: resolve(p), journey: null, application: false, expect: "none", tag: "clear", note: note.join(":") }); }
const frozen = { version: 1, account: sub.slice(0, 6), frozenAt: new Date().toISOString(), labeler: spec.labeler, note: spec.note, journeys, items };
const body = JSON.stringify(frozen, null, 1); const hash = createHash("sha256").update(body).digest("hex");
writeFileSync(`${dir}/validation-v1.json`, body); writeFileSync("docs/validation-set.sha256", `${hash}  validation-v1.json (account ${sub.slice(0, 6)}, ${items.length} messages, ${journeys.length} journeys; labels frozen before Milestone 2 code changes)\n`);
// reviewer sheet (local file, contains short subjects for convenience; stays outside the repository)
const { emails } = await fetchEmailsById(await refreshGmailAccessToken((await getGmailRefreshToken(sub))!), items.map((i) => i.id));
const subj = new Map(emails.map((m) => [m.id, `${m.receivedAt.toISOString().slice(0, 10)} · ${m.subject.slice(0, 80)}`]));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const link = (id: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${id}`;
const rowsHtml = (list: typeof items) => list.map((i) => `<tr data-id="${i.id}"><td><a href="${link(i.id)}" target="_blank" rel="noreferrer">${esc(subj.get(i.id) ?? i.id)}</a></td><td>${esc(i.application ? i.expect : `NOT an application: ${i.note ?? ""}`)}${i.tag !== "clear" ? ` <em>(${i.tag})</em>` : ""}</td><td><label><input type="radio" name="v${i.id}" value="agree"> agree</label> <label><input type="radio" name="v${i.id}" value="disagree"> disagree</label> <label><input type="radio" name="v${i.id}" value="unsure"> unsure</label> <input type="text" placeholder="what is right?" size="22"></td></tr>`).join("");
const sections = journeys.map((j) => `<h2>${esc(j.id)}: ${esc(j.label)}</h2><p>One application · cycle ${esc(j.cycle)} · ${esc(j.kind)} · final status ${esc(j.status)}${j.outcome ? ` · outcome ${esc(j.outcome)}` : ""}</p><table>${rowsHtml(items.filter((i) => i.journey === j.id))}</table>`).join("") + `<h2>Messages that are NOT applications</h2><table>${rowsHtml(items.filter((i) => !i.journey))}</table>`;
const html = `<!doctype html><meta charset="utf-8"><title>Validation review</title><style>body{font:14px system-ui;max-width:1000px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%;margin-bottom:8px}td{border-bottom:1px solid #ddd;padding:5px 6px;vertical-align:top}h2{margin:22px 0 2px;font-size:16px}p{margin:0 0 6px;color:#555}button{font-size:15px;padding:8px 14px}</style>
<h1>Validation review: ${items.length} messages, ${journeys.length} applications</h1><p><b>How:</b> click a link (it opens the real message in Gmail), then mark whether the label on the right is right. "Agree" if the message belongs to that application and is what the label says; "disagree" (and say what is right) if not; "unsure" if you cannot tell. When done press <b>Download verdicts</b> and send the file back. Nothing is uploaded anywhere.</p><p>Frozen label set sha256: ${hash.slice(0, 16)}…</p><button onclick="dl()">Download verdicts</button>${sections}<button onclick="dl()">Download verdicts</button>
<script>function dl(){const out=[...document.querySelectorAll('tr[data-id]')].map(tr=>({id:tr.dataset.id,verdict:(tr.querySelector('input[type=radio]:checked')||{}).value||'unanswered',note:tr.querySelector('input[type=text]').value}));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({labelHash:'${hash}',verdicts:out},null,1)],{type:'application/json'}));a.download='validation-verdicts.json';a.click()}</script>`;
writeFileSync(`${dir}/review.html`, html);
console.log(`frozen: ${items.length} messages (${items.filter((i) => i.journey).length} in ${journeys.length} journeys, ${items.filter((i) => !i.journey).length} negatives); sha256 ${hash.slice(0, 16)}…; review sheet ${dir}/review.html`);
process.exit(0);
