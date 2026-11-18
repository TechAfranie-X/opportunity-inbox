import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
const re = new RegExp(process.argv[3], "i");
for (const o of ws.opportunities.filter((x) => re.test(x.company))) {
  console.log(`## ${o.company} | ${o.role} | ${o.stage}/${o.status} outcome=${o.outcome}`);
  for (const e of o.events) console.log(`  ${e.occurredAt.toISOString().slice(0, 10)} ${e.type.padEnd(20)} conf=${e.confidence.toFixed(2)} ${e.corrected ? "C" : " "} ${e.subject.slice(0, 55)}`);
}
process.exit(0);
