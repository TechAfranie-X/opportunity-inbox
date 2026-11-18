/**
 * Message-to-opportunity grouping quality on the DEVELOPMENT mailbox (dev datasets only; BLIND is never read), legacy versus Identity v2, scored pairwise against the
 * human `opportunity_ref` labels. Aggregates only. A development set: it exercises multi-message opportunities weakly (few opportunities have several messages), so it is
 * a regression guard for precision/recall, not evidence about multi-cycle employers (the benchmark is).
 *   node --no-warnings --import ./scripts/loader/register.mjs benchmarks/lifecycle/tools/dev-grouping.ts <labels.json>
 * labels.json: rows { ds, id, field, value } exported from the evaluation database copy (fields is_recruiting, opportunity_ref) for the three development datasets.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { legacyGroupEvents } from "../../../lib/lifecycle/legacy.ts";
import { groupEventsV2 } from "../../../lib/lifecycle/identity.ts";
import { pairwise } from "../harness.ts";
import { readMail } from "../../../lib/reliability/assess.ts";
import type { EffectiveEvent, RecruitingEmail } from "../../../lib/recruiting/types.ts";

const DEV = ["dev-random-1", "validation-1", "validation-2"] as const;
const root = join(homedir(), ".opportunity-inbox", "eval");
const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as Array<{ ds: string; id: string; field: string; value: unknown }>;
const ref = new Map<string, string>(), recruiting = new Set<string>();
for (const r of rows) {
  if (r.field === "opportunity_ref" && typeof r.value === "string" && r.value && r.value !== "not_applicable") ref.set(`${r.ds}|${r.id}`, `${r.ds}|${r.value}`);
  if (r.field === "is_recruiting" && (r.value === true || r.value === "true")) recruiting.add(`${r.ds}|${r.id}`);
}
const truthGroups = new Map<string, string[]>(), legacy: string[][] = [], v2: string[][] = [];
let messages = 0;
for (const ds of DEV) {
  const members = new Set((JSON.parse(readFileSync(join(root, ds, "manifest.json"), "utf8")) as { memberIds: string[] }).memberIds);
  const emails: RecruitingEmail[] = readFileSync(join(root, ds, "messages.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => members.has(m.id) && !m.outbound).map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) }));
  const events = readMail(emails).map((e): EffectiveEvent => ({ ...e, id: `${ds}|${e.gmailMessageId}`, corrected: false }));
  const labelled = events.filter((e) => recruiting.has(e.id) && ref.has(e.id));
  messages += labelled.length;
  const keep = new Set(labelled.map((e) => e.id));
  for (const e of labelled) (truthGroups.get(ref.get(e.id)!) ?? truthGroups.set(ref.get(e.id)!, []).get(ref.get(e.id)!)!).push(e.id);
  for (const g of legacyGroupEvents(events)) legacy.push(g.events.filter((e) => keep.has(e.id)).map((e) => e.id));
  for (const g of groupEventsV2(events)) v2.push(g.events.filter((e) => keep.has(e.id)).map((e) => e.id));
}
const t = [...truthGroups.values()];
const f = (m: ReturnType<typeof pairwise>) => `precision ${(m.precision * 100).toFixed(1)}%  recall ${(m.recall * 100).toFixed(1)}%  (true pairs ${m.truePairs}, predicted ${m.predictedPairs}, wrong merges ${m.wrongMerges}, missed ${m.missedLinks})`;
console.log(`dev mailbox: ${messages} labelled recruiting messages in ${t.length} labelled opportunities (${t.filter((g) => g.length > 1).length} with several messages)`);
console.log(`legacy grouping : ${f(pairwise(t, legacy))}`);
console.log(`identity v2     : ${f(pairwise(t, v2))}`);
