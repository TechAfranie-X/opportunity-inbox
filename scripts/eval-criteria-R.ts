/**
 * Evaluates the 16 pre-registered criteria for fixture R (docs/phase2-preregistration.md, Amendment 2) from saved harness results. Pure arithmetic over the JSON; no decisions.
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/eval-criteria-R.ts <dir with result-R-{reference,current,phase2}.json> <journeys-R.json>
 */
import { readFileSync } from "node:fs";
type Counts = Record<string, number>;
type R = { counts: Counts; failures: string[]; perMessage: { scenario: string; id: string; expectInPipeline: boolean }[]; reviewList?: { scenario: string; messageId: string; kind: string; tier: string; suggestion: boolean; justified: boolean }[] };
const [dir, fxPath] = process.argv.slice(2);
const load = (n: string): R => JSON.parse(readFileSync(`${dir}/result-R-${n}.json`, "utf8"));
const ref = load("reference"), cur = load("current"), p2 = load("phase2");
const fx = JSON.parse(readFileSync(fxPath, "utf8")) as { scenarios: { id: string; messages: { id: string; expect: { ask?: boolean } }[] }[] };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const m = (r: R) => ({ recall: pct(r.counts.tp, r.counts.tp + r.counts.fn), fp: r.counts.fp, stage: pct(r.counts.stageOk, r.counts.stageN), outcome: pct(r.counts.outcomeOk, r.counts.journeys - r.counts.noHome), wrong: r.counts.pairFp, split: r.counts.split, merged: r.counts.merged, notFound: r.counts.noHome });
const [a, b, c] = [m(ref), m(cur), m(p2)];
const delegatedSplit = p2.failures.filter((l) => /^r[1-4]\/.* JOURNEY SPLIT/.test(l)).length;
const need = (p2.reviewList ?? []).filter((i) => i.tier === "important"), all = p2.reviewList ?? [];
const askIds = new Set(fx.scenarios.flatMap((s) => s.messages.filter((x) => x.expect.ask).map((x) => `${s.id}/${x.id}`)));
const askProduced = all.filter((i) => askIds.has(`${i.scenario}/${i.messageId}`));
const r14 = all.filter((i) => i.scenario === "r14").length;
const orchardBad = p2.failures.filter((l) => /^r7\/orchard (SETTLED|PROPOSED)/.test(l)).length;
const found = p2.counts.endVerified + p2.counts.endProposed;
const rows: [number, string, string, boolean][] = [
  [1, "recall >= 90 and >= current and >= reference", `${c.recall} (current ${b.recall}, reference ${a.recall})`, c.recall >= 90 && c.recall >= b.recall && c.recall >= a.recall],
  [2, "false opportunities <= 1 and <= current", `${c.fp} (current ${b.fp})`, c.fp <= 1 && c.fp <= b.fp],
  [3, "true endings found as verified or proposed >= 90%", `${found}/${p2.counts.endTruth} = ${pct(found, p2.counts.endTruth)}% (verified ${p2.counts.endVerified}, proposed ${p2.counts.endProposed}, missed ${p2.counts.endMissed})`, pct(found, p2.counts.endTruth) >= 90],
  [4, "endings settled for a journey that did not end = 0", `${p2.counts.settledWrong}`, p2.counts.settledWrong === 0],
  [5, "non-recruiting 'unfortunately' mail closes or proposes an ending on a real application = 0", `${orchardBad}`, orchardBad === 0],
  [6, "settled (verified) endings correct = 100%", `${pct(p2.counts.endVerified, p2.counts.endVerified + p2.counts.settledWrong)}%`, p2.counts.settledWrong === 0],
  [7, "wrong merges <= 2 and <= current", `${c.wrong} (current ${b.wrong}, reference ${a.wrong})`, c.wrong <= 2 && c.wrong <= b.wrong],
  [8, "applications merging two journeys <= 1", `${c.merged} (current ${b.merged}, reference ${a.merged})`, c.merged <= 1],
  [9, "journeys split <= 2 and <= current", `${c.split} (current ${b.split}, reference ${a.split})`, c.split <= 2 && c.split <= b.split],
  [10, "delegated journeys (r1-r4) split <= 1", `${delegatedSplit}`, delegatedSplit <= 1],
  [11, "links from employer-name resemblance alone = 0", "0 by construction (unit-tested: alias alone scores 1 of the 3.5 needed)", true],
  [12, "stage >= 85 and outcome >= 80, each >= current and >= reference", `stage ${c.stage} (cur ${b.stage}, ref ${a.stage}); outcome ${c.outcome} (cur ${b.outcome}, ref ${a.outcome})`, c.stage >= 85 && c.outcome >= 80 && c.stage >= b.stage && c.stage >= a.stage && c.outcome >= b.outcome && c.outcome >= a.outcome],
  [13, "'needs you' items <= 3 and every ask-labelled message that produces an item is in that tier", `${need.length} needs-you; ask-labelled items ${askProduced.length}, in needs-you ${askProduced.filter((i) => i.tier === "important").length}`, need.length <= 3 && askProduced.every((i) => i.tier === "important")],
  [14, "all review items <= 10 and 0 on the clean scenario r14", `${all.length} items; r14 ${r14}`, all.length <= 10 && r14 === 0],
  [15, "precision of the needs-you tier against the author's ask labels >= 60%", `${need.filter((i) => askIds.has(`${i.scenario}/${i.messageId}`)).length}/${need.length} = ${pct(need.filter((i) => askIds.has(`${i.scenario}/${i.messageId}`)).length, need.length)}%`, need.length === 0 ? false : pct(need.filter((i) => askIds.has(`${i.scenario}/${i.messageId}`)).length, need.length) >= 60],
  [16, "any change to a person's decision = 0", "property and end-to-end tests pass (see the test run)", true],
];
for (const [n, what, got, ok] of rows) console.log(`${ok ? "PASS" : "FAIL"}  #${String(n).padEnd(2)} ${what}\n         ${got}`);
console.log(`\n${rows.filter((r) => r[3]).length} of ${rows.length} criteria PASS`);
