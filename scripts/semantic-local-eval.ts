/**
 * Local semantic-reader evaluation on a fixture of FICTIONAL mailboxes (same format as scripts/eval-sealed.ts). Nothing leaves the machine: the transport only
 * accepts a loopback endpoint. Reports, for the model reader alone and for the deterministic pipeline on the same messages:
 *   triage recall (genuine messages the veto-only triage lets reach a reader), reader recall/precision, stage type accuracy, abstentions, latency.
 *
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/semantic-local-eval.ts <fixture.json> [--model <id>] [--batch N] [--verbose]
 */
import { readFileSync } from "node:fs";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { SEMANTIC_GUIDE_V3, SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { localTransport } from "../lib/semantic/local.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { usable } from "../lib/semantic/port.ts";
import type { RecruitingEmail } from "../lib/recruiting/types.ts";

type Msg = { id: string; from: string; subject: string; body: string; receivedAt: string; outbound?: boolean; expect: { inPipeline: boolean; type: string | null } };
const args = process.argv.slice(2);
const file = args[0];
const flag = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const model = flag("--model", "mlx-community/Qwen3-4B-Instruct-2507-4bit");
const batch = Number(flag("--batch", "4"));
const verbose = args.includes("--verbose");
const fx = JSON.parse(readFileSync(file, "utf8")) as { scenarios: { id: string; messages: Msg[] }[] };
const reader = createModelReader({ transport: localTransport(), model, batch, idPrefix: "local", guide: args.includes("--full") ? SEMANTIC_GUIDE_V3 : SEMANTIC_GUIDE_V3_COMPACT });

let tp = 0, fp = 0, fn = 0, tn = 0, notSentPos = 0, notSentNeg = 0, typeOk = 0, typeN = 0, abst = 0, n = 0;
const rows: string[] = [];
const t0 = Date.now();
for (const sc of fx.scenarios) {
  const emails: RecruitingEmail[] = sc.messages.filter((m) => !m.outbound).map((m) => ({ id: m.id, threadId: `t-${sc.id}`, from: m.from, subject: m.subject, bodyText: m.body, receivedAt: new Date(m.receivedAt), outbound: false }));
  const inputs = semanticInputs(emails);
  const sent = new Set(inputs.map((i) => i.key));
  const out = await reader.opine(inputs);
  for (const m of sc.messages.filter((x) => !x.outbound)) {
    n++;
    const pos = m.expect.inPipeline;
    if (!sent.has(m.id)) { if (pos) { notSentPos++; fn++; rows.push(`${m.id} NOT SENT (triage) :: ${m.subject}`); } else { notSentNeg++; tn++; } continue; }
    const o = out.get(m.id);
    const yes = !!o && usable(o) && o.recruiting;
    if (!o || !usable(o)) abst++;
    if (pos && yes) { tp++; if (m.expect.type) { typeN++; if (o!.type === m.expect.type) typeOk++; } } else if (pos) { fn++; rows.push(`${m.id} MISSED (${o ? o.status + "/" + o.certainty + "/" + o.recruiting : "none"}) exp ${m.expect.type} :: ${m.subject}`); } else if (yes) { fp++; rows.push(`${m.id} FALSE POSITIVE ${o!.type} :: ${m.subject}`); } else tn++;
  }
}
const sec = (Date.now() - t0) / 1000;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const posTotal = tp + fn;
console.log(`model ${model}  messages ${n}  genuine ${posTotal}  other ${tn + fp}`);
console.log(`triage recall (genuine messages that reach the reader): ${pct(posTotal - notSentPos, posTotal)}   (${notSentPos} genuine and ${notSentNeg} other messages not sent)`);
console.log(`reader: precision ${pct(tp, tp + fp)} (${fp} false positives), recall ${pct(tp, posTotal)} overall, ${pct(tp, posTotal - notSentPos)} of those sent; abstentions ${abst}`);
console.log(`stage type on found positives: ${pct(typeOk, typeN)}   latency ${(sec / Math.max(1, n)).toFixed(2)} s/message (${sec.toFixed(0)} s total)`);
if (verbose) for (const r of rows) console.log(" -", r.slice(0, 170));
