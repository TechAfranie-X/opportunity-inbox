/** Read-only: families of sibling opportunities (same company key + same role) in the live workspace, with their evidence, to decide which are one journey and which are separate applications. node ... scripts/sibling-families.ts <sub> [--details] */
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { companyKey } from "../lib/recruiting/company.ts";
const sub = process.argv[2]; const details = process.argv.includes("--details");
const ws = await loadWorkspace(sub, new Date());
const fam = new Map<string, typeof ws.opportunities>();
for (const o of ws.opportunities) { const k = `${companyKey(o.company)}|${(o.role ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`; fam.set(k, [...(fam.get(k) ?? []), o]); }
const sibs = [...fam].filter(([, v]) => v.length > 1);
console.log(`${sibs.length} sibling families (${sibs.reduce((a, [, v]) => a + v.length, 0)} opportunities, ${sibs.reduce((a, [, v]) => a + v.reduce((b, o) => b + o.events.length, 0), 0)} events) of ${ws.opportunities.length} opportunities`);
for (const [k, v] of sibs.sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${k.slice(0, 70)}  groups=${v.length} events=${v.reduce((a, o) => a + o.events.length, 0)}`);
  if (!details) continue;
  for (const o of v.slice(0, 8)) {
    const evs = o.events.filter((e) => !e.outbound); const types = evs.map((e) => e.type[0]).join("");
    const reqs = [...new Set(evs.map((e) => e.signals.find((s) => s.startsWith("req:"))).filter(Boolean))].join(",");
    console.log(`   ${o.status}/${o.stage} n=${evs.length} ${types.slice(0, 30)} ${evs[0].occurredAt.toISOString().slice(2, 10)}..${evs[evs.length - 1].occurredAt.toISOString().slice(2, 10)} threads=${new Set(evs.map((e) => e.gmailThreadId)).size} senders=${[...new Set(evs.map((e) => e.senderDomain))].slice(0, 2).join("/")} req=[${reqs}] first="${(evs[0].subject ?? "").slice(0, 48)}"`);
  }
}
process.exit(0);
