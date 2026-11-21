/**
 * READ-ONLY shadow comparison of two semantic readers on IDENTICAL real messages with the real local model: A = production (guide v3 compact, whole body as one text), B = context-separated
 * (guide v4: current text, quoted history, forwarded evidence, signature as labelled parts). Nothing is stored or changed. Prints a scorecard and every disagreement (short subject, ids).
 *   node ... scripts/compare-readers.ts <googleSub> [max=120]
 * References: a person's correction (authoritative) where one exists, else deterministic facts that need no model (an employer's own ending sentence -> rejection, an own-application receipt with no
 * ending -> applied/not a rejection, a message class -> not an application, an acknowledged withdrawal -> withdrawn). Messages without a reference are compared for agreement only.
 */
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { splitMessage } from "../lib/gmail/message-parts.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { endingWording, ownApplicationStatement, ownEnding, withdrawalAcknowledged } from "../lib/reliability/evidence.ts";
import { messageClass } from "../lib/reliability/message-class.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { SEMANTIC_GUIDE_V4 } from "../lib/semantic/guide-v4.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { localTransport } from "../lib/semantic/local.ts";
const sub = process.argv[2], max = Number(process.argv[3] ?? 120);
const ws = await loadWorkspace(sub, new Date());
const all = ws.opportunities.flatMap((o) => o.events.filter((e) => !e.outbound).map((e) => ({ o, e })));
const isReplyish = (s: string | null) => /^\s*(re|fwd?|fw|aw|tr)\s*:/i.test(s ?? "");
const replies = all.filter((x) => isReplyish(x.e.subject));
const plain = all.filter((x) => !isReplyish(x.e.subject)).sort(() => 0.5 - Math.random());
const nPlain = Math.max(20, Math.floor(max * 0.3));
const pick = [...replies.sort(() => 0.5 - Math.random()).slice(0, max - nPlain), ...plain.slice(0, nPlain)];
const stored = new Map(pick.map((x) => [x.e.gmailMessageId, x] as const));
const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
const emails: Awaited<ReturnType<typeof fetchEmailsById>>["emails"] = [];
for (let i = 0; i < pick.length; i += 20) emails.push(...(await fetchEmailsById(token, pick.slice(i, i + 20).map((x) => x.e.gmailMessageId))).emails);
const mk = (guide: string) => createModelReader({ transport: localTransport(), model: "mlx-community/Qwen3-4B-Instruct-2507-4bit", batch: 4, idPrefix: "cmp", guide });
const t0 = Date.now();
const A = await mk(SEMANTIC_GUIDE_V3_COMPACT).readings!(semanticInputs(emails, [], { parts: false }));
const tA = Date.now() - t0;
const B = await mk(SEMANTIC_GUIDE_V4).readings!(semanticInputs(emails, [], { parts: true }));
const tB = Date.now() - t0 - tA;
type Ref = { kind: string; recruiting?: boolean; types?: string[]; notTypes?: string[] };
const ref = (id: string): Ref | null => {
  const s = stored.get(id)!; const m = emails.find((x) => x.id === id)!;
  if (s.e.corrected || s.e.confirmed) return { kind: "person", types: [s.e.type] };
  const c = messageClass(m); if (c && c !== "program-acceptance") return { kind: `class:${c}`, recruiting: false };
  if (withdrawalAcknowledged(m)) return { kind: "fact:withdrawal", types: ["withdrawn", "status_update"] };
  if (ownEnding(m)) return { kind: "fact:own-ending", types: ["rejection"] };
  if (ownApplicationStatement(m) && !endingWording(m)) return { kind: "fact:receipt", notTypes: ["rejection", "offer", "withdrawn"] };
  return null;
};
const okAgainst = (r: Ref, rec: boolean, type: string | null) => (r.recruiting === false ? !rec : r.types ? rec && !!type && r.types.includes(type) : r.notTypes ? !(rec && !!type && r.notTypes.includes(type)) : true);
const sc = { n: 0, withRef: 0, agree: 0, aOk: 0, bOk: 0, bOnlyOk: 0, aOnlyOk: 0, quotedFlip: 0 };
const lines: string[] = []; const byKind = new Map<string, { n: number; a: number; b: number }>();
for (const m of emails) {
  const a = A.get(m.id)?.output, b = B.get(m.id)?.output; sc.n++;
  const ra = a?.status === "ok" && a.recruiting && a.certainty !== "low", rb = b?.status === "ok" && b.recruiting && b.certainty !== "low";
  const ta = ra ? a!.type : null, tb = rb ? b!.type : null;
  if (ra === rb && ta === tb) sc.agree++;
  const r = ref(m.id); const p = splitMessage(m.subject, m.bodyText);
  if (r) {
    sc.withRef++; const ao = okAgainst(r, ra, ta), bo = okAgainst(r, rb, tb);
    if (ao) sc.aOk++; if (bo) sc.bOk++; if (bo && !ao) sc.bOnlyOk++; if (ao && !bo) sc.aOnlyOk++;
    const k = byKind.get(r.kind) ?? { n: 0, a: 0, b: 0 }; k.n++; if (ao) k.a++; if (bo) k.b++; byKind.set(r.kind, k);
    if (ao !== bo) lines.push(`${bo ? "B-BETTER" : "A-BETTER"} ${m.id.slice(0, 8)} ref=${r.kind} A=${ra ? ta : "no"} B=${rb ? tb : "no"} hasQuoted=${p.meta.hasQuoted} | ${m.subject.slice(0, 55)}`);
  } else if (ra !== rb || ta !== tb) lines.push(`DIFFER  ${m.id.slice(0, 8)} no-ref A=${ra ? ta : "no"} B=${rb ? tb : "no"} hasQuoted=${p.meta.hasQuoted} | ${m.subject.slice(0, 55)}`);
  if (p.meta.hasQuoted && (ta !== tb || ra !== rb)) sc.quotedFlip++;
}
console.log(`messages ${sc.n} (${replies.length ? "reply-heavy sample" : ""}); readers answered A ${A.size}, B ${B.size}; time A ${(tA / 1000).toFixed(0)}s B ${(tB / 1000).toFixed(0)}s`);
console.log(`A and B give the same recruiting/type answer on ${sc.agree}/${sc.n}; they differ on ${sc.n - sc.agree}, of which ${sc.quotedFlip} have quoted history`);
console.log(`against a reference (${sc.withRef} messages): A correct ${sc.aOk}, B correct ${sc.bOk}; B fixes ${sc.bOnlyOk}, B breaks ${sc.aOnlyOk}`);
for (const [k, v] of byKind) console.log(`   ${k.padEnd(18)} n=${String(v.n).padStart(3)}  A ${v.a}  B ${v.b}`);
for (const l of lines) console.log(l);
process.exit(0);
