/**
 * Draws a FRESH, stratified holdout of real stored messages for the independent reader comparison, writes the draw (ids + strata, no text) outside the repository, writes only its hash to
 * docs/holdout-draw.sha256, and builds a BLIND review sheet (no product answer is shown) for an independent evaluator. Excludes every message of the development validation set.
 *   node ... scripts/holdout-draw.ts <googleSub> [--n 120] [--seed holdout-1]
 * Commit the hash BEFORE running the readers (scripts/holdout-run.ts), so the draw cannot depend on how they do.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
const sub = process.argv[2]; const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const N = Number(arg("--n", "120")), seed = arg("--seed", "holdout-1");
const dir = `${homedir()}/.opportunity-inbox-validation/holdout-v1`; mkdirSync(dir, { recursive: true });
const dev = new Set((JSON.parse(readFileSync(`${homedir()}/.opportunity-inbox-validation/validation-v1.json`, "utf8")) as { items: { id: string }[] }).items.map((i) => i.id));
// seeded shuffle (mulberry32 over a hash of the seed)
let h = createHash("sha256").update(seed).digest().readUInt32LE(0);
const rnd = () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const ws = await loadWorkspace(sub, new Date());
type Row = { id: string; type: string; subject: string; signals: string[]; weak: boolean };
const rows: Row[] = [...ws.opportunities.flatMap((o) => o.events.filter((e) => !e.outbound).map((e) => ({ id: e.gmailMessageId, type: e.type, subject: e.subject ?? "", signals: e.signals, weak: false }))), ...ws.possible.filter((e) => !e.outbound).map((e) => ({ id: e.gmailMessageId, type: e.type, subject: e.subject ?? "", signals: e.signals, weak: true }))].filter((r) => !dev.has(r.id));
const seen = new Set<string>(); const pool = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
const reply = (r: Row) => /^\s*(re|aw|sv)\s*:/i.test(r.subject), fwd = (r: Row) => /^\s*(fwd?|fw|tr|wg)\s*:/i.test(r.subject), cls = (r: Row) => r.signals.some((s) => /^class:/.test(s));
const strata: [string, (r: Row) => boolean, number][] = [
  ["forward", (r) => fwd(r), 8], ["reply-terminal-or-offer", (r) => reply(r) && ["offer", "rejection", "withdrawn"].includes(r.type), 12], ["reply-stage", (r) => reply(r) && ["assessment", "interview_invite", "interview_scheduled"].includes(r.type), 14],
  ["reply-other", (r) => reply(r) && !fwd(r), 8],
  // hard negatives: the messages most likely to be misread as an offer or a terminal outcome
  ["offer-lookalike", (r) => r.type !== "offer" && /congrat|welcome|offer|accepted|you.?re in|selected|pleased/i.test(r.subject), 14], ["terminal-lookalike", (r) => !["rejection", "withdrawn"].includes(r.type) && /unfortunately|decision|regarding your application|status|update on|not (?:be )?selected|no longer/i.test(r.subject), 12], ["offer", (r) => r.type === "offer" && !reply(r), 10], ["rejection", (r) => r.type === "rejection" && !reply(r), 14], ["assessment", (r) => r.type === "assessment" && !reply(r), 10],
  ["interview", (r) => ["interview_invite", "interview_scheduled"].includes(r.type) && !reply(r), 12], ["program-or-class", (r) => cls(r), 12], ["applied", (r) => r.type === "applied" && !reply(r) && !cls(r), 10],
  ["status", (r) => r.type === "status_update" && !reply(r) && !cls(r), 8], ["weak-possible", (r) => r.weak && !cls(r), 8],
];
const taken = new Set<string>(); const items: { id: string; stratum: string }[] = [];
for (const [name, f, want] of strata) { let got = 0; for (const r of shuffle(pool.filter(f))) { if (got >= want || taken.has(r.id)) continue; taken.add(r.id); items.push({ id: r.id, stratum: name }); got++; } }
const ordered = shuffle(items).slice(0, N);
const counts: Record<string, number> = {}; for (const i of ordered) counts[i.stratum] = (counts[i.stratum] ?? 0) + 1;
const draw = { version: "holdout-v1", seed, account: sub.slice(0, 6), drawnAt: new Date().toISOString(), excludedDevelopmentMessages: dev.size, items: ordered };
const body = JSON.stringify(draw); writeFileSync(`${dir}/draw.json`, body);
const hash = createHash("sha256").update(body).digest("hex");
writeFileSync("docs/holdout-draw.sha256", `${hash}  holdout-v1/draw.json (${ordered.length} messages, strata ${JSON.stringify(counts)}; drawn before any reader was run on it)\n`);
const er = await getDb().execute(sql`select gmail_email from gmail_connections where user_google_sub = ${sub}`);
const email = (((Array.isArray(er) ? er : (er as { rows: unknown[] }).rows) as { gmail_email: string }[])[0]?.gmail_email) ?? "";
const TYPES = ["applied (application receipt)", "assessment", "interview_invite", "interview_scheduled", "job offer", "program or fellowship acceptance", "rejection", "withdrawn", "other message inside the process", "not part of a recruiting process (event, marketing, admin, survey)"];
const html = `<!doctype html><meta charset="utf-8"><title>Holdout review (blind)</title><style>body{font:15px system-ui;max-width:860px;margin:2rem auto;padding:0 1rem}.row{border-bottom:1px solid #ddd;padding:.8rem 0}select,textarea{font:inherit;margin:.2rem .5rem .2rem 0}a{color:#1a56db}</style>
<h1>Holdout review (blind)</h1><p>Open each message in Gmail and say what the <b>newly written text of that message</b> does, ignoring anything quoted below it. No product answer is shown. Download the file at the end and send it back. Draw hash: <code>${hash.slice(0, 16)}…</code></p><div id="rows"></div><button id="dl" style="margin:1rem 0;padding:.6rem 1rem">Download labels</button>
<script>const ids=${JSON.stringify(ordered.map((i) => i.id))};const types=${JSON.stringify(TYPES)};const email=${JSON.stringify(email)};
const rows=document.getElementById("rows");ids.forEach((id,i)=>{const d=document.createElement("div");d.className="row";d.innerHTML='<b>'+(i+1)+'.</b> <a target="_blank" rel="noopener" href="https://mail.google.com/mail/'+(email?'?authuser='+encodeURIComponent(email):'')+'#all/'+id+'">Open in Gmail</a><br>Recruiting process of the recipient? <select data-k="rec"><option value="">-</option><option>yes</option><option>no</option><option>unsure</option></select> What the new text does: <select data-k="type"><option value="">-</option>'+types.map(t=>'<option>'+t+'</option>').join("")+'</select><label><input type="checkbox" data-k="quotedOnly"> the event appears only in quoted or forwarded text</label><br><textarea data-k="note" rows="1" cols="60" placeholder="note (optional)"></textarea>';d.dataset.id=id;rows.appendChild(d)});
document.getElementById("dl").onclick=()=>{const labels=[...rows.children].map(d=>({id:d.dataset.id,recruiting:d.querySelector('[data-k=rec]').value,type:d.querySelector('[data-k=type]').value,quotedOnly:d.querySelector('[data-k=quotedOnly]').checked,note:d.querySelector('[data-k=note]').value}));const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify({drawHash:${JSON.stringify(hash)},labels},null,1)],{type:"application/json"}));a.download="holdout-labels.json";a.click()};</script>`;
writeFileSync(`${dir}/review.html`, html);
console.log(`drew ${ordered.length} of a pool of ${pool.length} (excluded ${dev.size} development messages); strata ${JSON.stringify(counts)}; hash ${hash.slice(0, 16)}…; sheet ${dir}/review.html`);
process.exit(0);
