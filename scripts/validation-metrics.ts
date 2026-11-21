/**
 * Scores the LIVE product against the frozen private validation set (ids and labels only; the file lives outside the repository). Refuses to run if the labels differ from the hash recorded in
 * docs/validation-set.sha256. Items tagged `disputed`, and items a second evaluator disagreed with (--verdicts), are excluded from scoring and listed.
 *   node ... scripts/validation-metrics.ts <googleSub> [--verdicts validation-verdicts.json] [--details]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { reviewOptions } from "../lib/recruiting/product-config.ts";
import { attentionCount, buildReviewQueue } from "../lib/recruiting/review.ts";
const sub = process.argv[2]; const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const file = `${homedir()}/.opportunity-inbox-validation/validation-v1.json`; const raw = readFileSync(file, "utf8");
const want = readFileSync("docs/validation-set.sha256", "utf8").split(/\s+/)[0];
if (createHash("sha256").update(raw).digest("hex") !== want) { console.error("REFUSED: the validation labels differ from the frozen hash in docs/validation-set.sha256"); process.exit(2); }
type Item = { id: string; journey: string | null; expect: string; tag: string; note?: string };
type Journey = { id: string; label: string; kind: string; status: string; outcome: string | null; cycle: string; messages: string[] };
const set = JSON.parse(raw) as { items: Item[]; journeys: Journey[] };
const disagreed = new Set<string>(); const vf = arg("--verdicts");
if (vf) { const v = JSON.parse(readFileSync(vf, "utf8")) as { labelHash: string; verdicts: { id: string; verdict: string }[] }; if (v.labelHash !== want) { console.error("REFUSED: the verdicts were made against different labels"); process.exit(2); } for (const x of v.verdicts) if (x.verdict === "disagree" || x.verdict === "unsure") disagreed.add(x.id); }
const excluded = (i: Item) => i.tag === "disputed" || disagreed.has(i.id);
const ws = await loadWorkspace(sub, new Date());
const where = new Map<string, { opp: (typeof ws.opportunities)[number]; type: string }>();
for (const o of ws.opportunities) for (const e of o.events) where.set(e.gmailMessageId, { opp: o, type: e.type });
const scored = set.items.filter((i) => !excluded(i));
const pos = scored.filter((i) => i.journey && i.expect !== "none"), neg = scored.filter((i) => !i.journey);
const found = pos.filter((i) => where.has(i.id)), falseOpp = neg.filter((i) => where.has(i.id));
const TYPES: Record<string, string[]> = { applied: ["applied"], assessment: ["assessment", "assessment_completed"], interview: ["interview_invite", "interview_scheduled"], offer: ["offer"], rejection: ["rejection"] };
const typed = pos.filter((i) => TYPES[i.expect]); const typeOk = typed.filter((i) => where.has(i.id) && TYPES[i.expect].includes(where.get(i.id)!.type));
const typeBad = typed.filter((i) => !typeOk.includes(i));
const acceptance = pos.filter((i) => i.expect === "acceptance"); const acceptBad = acceptance.filter((i) => { const w = where.get(i.id); return w && w.type === "offer" && (w.opp.kind ?? "job") === "job"; });
// identity
const jOf = new Map<string, string>(); for (const j of set.journeys) for (const m of j.messages) if (!excluded(set.items.find((x) => x.id === m)!)) jOf.set(m, j.id);
const oppsOf = new Map<string, Set<string>>(); const jsIn = new Map<string, Set<string>>();
for (const [m, j] of jOf) { const w = where.get(m); if (!w || set.items.find((x) => x.id === m)!.expect === "none" && false) continue; if (!w) continue; (oppsOf.get(j) ?? oppsOf.set(j, new Set()).get(j)!).add(w.opp.key); (jsIn.get(w.opp.key) ?? jsIn.set(w.opp.key, new Set()).get(w.opp.key)!).add(j); }
const split = [...oppsOf].filter(([, s]) => s.size > 1).map(([j]) => j);
const merged = [...jsIn].filter(([, s]) => s.size > 1).map(([k, s]) => [...s].sort().join("+"));
const mergedPairs = new Set(merged);
// lifecycle
const life: { closed: number; verified: number; proposed: number; missed: number; settledWrong: number; activeTruth: number; offerTruth: number; offerOk: number; rejOk: number; rejTruth: number } = { closed: 0, verified: 0, proposed: 0, missed: 0, settledWrong: 0, activeTruth: 0, offerTruth: 0, offerOk: 0, rejOk: 0, rejTruth: 0 };
const lifeFail: string[] = [];
for (const j of set.journeys) {
  const counts = new Map<string, number>(); for (const m of j.messages) { const w = where.get(m); if (w && !excluded(set.items.find((x) => x.id === m)!)) counts.set(w.opp.key, (counts.get(w.opp.key) ?? 0) + 1); }
  const home = [...counts].sort((a, b) => b[1] - a[1])[0]; const opp = home && ws.opportunities.find((o) => o.key === home[0]);
  if (j.status === "closed") { life.closed++; if (opp && opp.status === "closed") life.verified++; else if (opp?.proposedEnding) life.proposed++; else { life.missed++; lifeFail.push(`${j.id}: truth closed, product ${opp ? opp.status : "not found"}`); } }
  if (j.status === "active") { life.activeTruth++; if (opp && opp.status === "closed") { life.settledWrong++; lifeFail.push(`${j.id}: truth active, product CLOSED`); } }
  if (j.outcome === "offer") { life.offerTruth++; if (opp && (opp.outcome === "offer" || opp.outcome === "accepted" || opp.stage === "offer")) life.offerOk++; else lifeFail.push(`${j.id}: truth offer, product ${opp?.stage ?? "not found"}`); }
  if (j.outcome === "rejected") { life.rejTruth++; if (opp && (opp.closedBy === "rejected" || opp.proposedEnding?.outcome === "rejected")) life.rejOk++; }
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const queue = buildReviewQueue(ws.opportunities, undefined, ws.possible, new Date(), reviewOptions());
console.log(`validation set ${want.slice(0, 12)}…: ${scored.length} scored of ${set.items.length} messages (${set.items.length - scored.length} excluded: disputed or disagreed), ${set.journeys.length} journeys`);
console.log(`detection: application messages in the pipeline ${found.length}/${pos.length} = ${pct(found.length, pos.length)} (recall)`);
console.log(`false opportunities: non-application messages in the pipeline ${falseOpp.length}/${neg.length}`);
console.log(`type correct: ${typeOk.length}/${typed.length} = ${pct(typeOk.length, typed.length)}; program acceptances shown as a job OFFER: ${acceptBad.length}/${acceptance.length}`);
console.log(`identity: journeys SPLIT across opportunities ${split.length}/${set.journeys.length}; opportunities that MERGE different journeys ${mergedPairs.size}`);
console.log(`lifecycle: truth-closed journeys verified closed ${life.verified}, proposed ${life.proposed}, missed ${life.missed} (of ${life.closed}); truth-active journeys wrongly closed ${life.settledWrong}/${life.activeTruth}; offers kept ${life.offerOk}/${life.offerTruth}`);
console.log(`review burden: needs-you ${attentionCount(queue)}, all items ${queue.filter((q) => !q.weak).length}`);
if (process.argv.includes("--details")) {
  console.log("MISSED application messages:"); for (const i of pos.filter((x) => !where.has(x.id))) console.log(`   ${i.journey} ${i.id.slice(0, 8)} (${i.expect})`);
  console.log("FALSE opportunities:"); for (const i of falseOpp) console.log(`   ${i.id.slice(0, 8)} ${i.note ?? ""}`);
  console.log("WRONG type:"); for (const i of typeBad) console.log(`   ${i.journey} ${i.id.slice(0, 8)} expected ${i.expect}, product ${where.get(i.id)?.type ?? "(not in pipeline)"}`);
  console.log("SPLIT journeys:"); for (const j of split) console.log(`   ${j} -> ${oppsOf.get(j)!.size} opportunities`);
  console.log("MERGED:"); for (const m of mergedPairs) console.log(`   ${m}`);
  console.log("LIFECYCLE failures:"); for (const l of lifeFail) console.log(`   ${l}`);
}
process.exit(0);
