/**
 * READ-ONLY comparison of the production decision chain and the Phase 2 engine on REAL messages, with the real local model. Nothing is stored. Prints, per disagreement, a short subject, the
 * stored (production) type and both engines' outcome so a person can judge who was right.  node ... scripts/compare-engines-real.ts <googleSub> [max]
 */
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { shadowAssist } from "../lib/decision/shadow.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { isNearMiss } from "../lib/reliability/flags.ts";
import { readMail } from "../lib/reliability/assess.ts";
import { applyAssist } from "../lib/semantic/assist.ts";
import { reconcileReadings } from "../lib/semantic/employer.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { localTransport } from "../lib/semantic/local.ts";
const sub = process.argv[2], max = Number(process.argv[3] ?? 150);
const ws = await loadWorkspace(sub, new Date());
const CONS = new Set(["offer", "rejection", "withdrawn", "interview_invite", "interview_scheduled", "assessment"]);
const all = ws.opportunities.flatMap((o) => o.events.filter((e) => !e.outbound).map((e) => ({ o, e })));
const modelCons = all.filter((x) => CONS.has(x.e.type) && x.e.signals.includes("semantic:event"));
const ruleCons = all.filter((x) => CONS.has(x.e.type) && !x.e.signals.includes("semantic:event")).sort(() => 0.5 - Math.random());
const pick = [...modelCons, ...ruleCons].slice(0, max);
const stored = new Map(pick.map((x) => [x.e.gmailMessageId, x] as const));
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const emails = [];
for (let i = 0; i < pick.length; i += 20) emails.push(...(await fetchEmailsById(token, pick.slice(i, i + 20).map((x) => x.e.gmailMessageId))).emails);
const rules = readMail(emails);
const reader = createModelReader({ transport: localTransport(), model: "mlx-community/Qwen3-4B-Instruct-2507-4bit", batch: 4, idPrefix: "local", guide: SEMANTIC_GUIDE_V3_COMPACT });
const readings = await reader.readings!(semanticInputs(emails));
const opinions = new Map([...readings].map(([k, v]) => [k, v.output] as const));
const A = reconcileReadings(applyAssist(rules, emails, opinions), readings), B = reconcileReadings(shadowAssist(rules, emails, opinions), readings);
const outcome = (evs: typeof A, id: string) => { const e = evs.find((x) => x.gmailMessageId === id && !x.outbound); if (!e) return "ABSENT"; if (isNearMiss(e)) return "possible"; return e.type + (e.signals.includes("terminal:proposed") ? "(proposed)" : ""); };
let same = 0; const diffs: string[] = [];
for (const m of emails) {
  const s = stored.get(m.id)!; const a = outcome(A, m.id), b = outcome(B, m.id);
  if (a === b) { same++; continue; }
  diffs.push(`${s.o.company.slice(0, 20).padEnd(20)}|stored ${s.e.type.padEnd(17)}${s.e.signals.includes("semantic:event") ? "(model)" : "(rule) "}|prod ${a.padEnd(22)}|phase2 ${b.padEnd(24)}|${m.subject.slice(0, 54)}`);
}
console.log(`messages ${emails.length}; identical outcome ${same}; differ ${diffs.length}`);
for (const d of diffs) console.log(d);
process.exit(0);
