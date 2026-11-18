/**
 * Sealed generalization check: runs the product's read path (readMail, then the same refinement and near-miss split as loadWorkspace, then grouping) over a
 * fixture of FICTIONAL mailboxes written by an independent author who did not see the code. Nothing here reads a database or a real mailbox.
 *
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/eval-sealed.ts <fixture.json> [--verbose]
 *
 * Rules of use (docs/generalization-policy.md): run a sealed fixture once per milestone, record the number, and never tune against its answers. After a
 * failure is inspected the fixture is contaminated for unbiased evaluation: fix the general pattern, add original tests, and measure on a NEW fixture.
 */
import { readFileSync } from "node:fs";
import { refineEvents } from "../lib/lifecycle/refine.ts";
import { buildOpportunities } from "../lib/recruiting/opportunity.ts";
import type { EffectiveEvent, RecruitingEmail } from "../lib/recruiting/types.ts";
import { isNearMiss } from "../lib/reliability/flags.ts";
import { readMail } from "../lib/reliability/assess.ts";

type Msg = { id: string; from: string; subject: string; body: string; receivedAt: string; outbound?: boolean; discovery?: "keyword" | "sweep"; expect: { inPipeline: boolean; type: string | null; opportunityKey: string | null } };
type Fixture = { scenarios: { id: string; note?: string; messages: Msg[] }[] };

const file = process.argv[2];
const verbose = process.argv.includes("--verbose");
const fx = JSON.parse(readFileSync(file, "utf8")) as Fixture;

let tp = 0, fp = 0, fn = 0, tn = 0, typeOk = 0, typeN = 0;
let pairTp = 0, pairFp = 0, pairFn = 0;
const misses: string[] = [];

for (const sc of fx.scenarios) {
  const emails: RecruitingEmail[] = sc.messages.map((m) => ({ id: m.id, threadId: `t-${m.id}`, from: m.from, subject: m.subject, bodyText: m.body, receivedAt: new Date(m.receivedAt), outbound: m.outbound ?? false }));
  const disc = new Map(sc.messages.map((m) => [m.id, m.discovery ?? "keyword"]));
  const read = readMail(emails).map((e) => ({ ...e, signals: disc.get(e.gmailMessageId) === "sweep" ? [...e.signals, "via:sweep"] : e.signals }));
  const effective: EffectiveEvent[] = read.map((e) => ({ ...e, id: e.gmailMessageId, corrected: false }));
  const all = refineEvents(effective).events;
  const pipeline = all.filter((e) => !isNearMiss(e));
  const opps = buildOpportunities(pipeline);
  const inPipe = new Map<string, { type: string; opp: string }>();
  opps.forEach((o, i) => o.events.forEach((e) => inPipe.set(e.gmailMessageId, { type: e.type, opp: String(i) })));
  const ms = sc.messages.filter((m) => !m.outbound);
  for (const m of ms) {
    const got = inPipe.get(m.id);
    if (m.expect.inPipeline && got) { tp++; if (m.expect.type) { typeN++; if (got.type === m.expect.type) typeOk++; else misses.push(`${sc.id}/${m.id} type ${got.type} != ${m.expect.type} :: ${m.subject}`); } }
    else if (m.expect.inPipeline && !got) { fn++; misses.push(`${sc.id}/${m.id} MISSED (expected ${m.expect.type}) :: ${m.subject}`); }
    else if (!m.expect.inPipeline && got) { fp++; misses.push(`${sc.id}/${m.id} FALSE POSITIVE as ${got.type} :: ${m.subject}`); }
    else tn++;
  }
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
    const a = ms[i], b = ms[j];
    if (!a.expect.inPipeline || !b.expect.inPipeline) continue;
    const same = a.expect.opportunityKey !== null && a.expect.opportunityKey === b.expect.opportunityKey;
    const ga = inPipe.get(a.id), gb = inPipe.get(b.id);
    const grouped = !!ga && !!gb && ga.opp === gb.opp;
    if (same && grouped) pairTp++; else if (same && ga && gb) { pairFn++; if (verbose) misses.push(`${sc.id} split: ${a.subject} | ${b.subject}`); } else if (!same && grouped) { pairFp++; misses.push(`${sc.id} WRONG MERGE: ${a.subject} | ${b.subject}`); }
  }
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
console.log(`messages ${tp + fp + fn + tn}: in-pipeline precision ${pct(tp, tp + fp)} (${fp} false positives), recall ${pct(tp, tp + fn)} (${fn} missed), non-recruiting kept out ${pct(tn, tn + fp)}`);
console.log(`stage type on found positives: ${pct(typeOk, typeN)} (${typeOk}/${typeN})`);
console.log(`grouping (pairs of labelled positives): precision ${pct(pairTp, pairTp + pairFp)}, recall ${pct(pairTp, pairTp + pairFn)}, wrong merges ${pairFp}, missed links ${pairFn}`);
if (verbose) for (const m of misses) console.log(" -", m);
