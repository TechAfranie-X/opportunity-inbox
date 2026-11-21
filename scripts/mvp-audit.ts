/** Read-only composition audit of one account's pipeline (metadata only: counts, kinds, evidence classes; company names only when asked). node ... scripts/mvp-audit.ts <sub> [--names] */
import { loadWorkspace } from "../lib/recruiting/store.ts";
const sub = process.argv[2]; const names = process.argv.includes("--names");
const ws = await loadWorkspace(sub, new Date());
const cls = (o: (typeof ws.opportunities)[number]) => {
  const ev = o.events.filter((e) => !e.outbound);
  const modelOnly = ev.every((e) => e.signals.includes("semantic:event"));
  const ruleFound = ev.some((e) => !e.signals.includes("semantic:event") && !e.signals.includes("near-miss"));
  return modelOnly ? "model-only" : ruleFound ? "rule-found" : "other";
};
const by: Record<string, number> = {};
for (const o of ws.opportunities) { const k = `${o.status}/${o.kind ?? "job"}/${cls(o)}/${o.events.filter((e) => !e.outbound).length > 1 ? "multi" : "single"}`; by[k] = (by[k] ?? 0) + 1; }
for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), k);
console.log("possible (near misses):", ws.possible.length, "| events:", ws.eventCount);
if (names) for (const o of ws.opportunities.filter((x) => x.status === "active" && cls(x) === "model-only" && x.events.length === 1).slice(0, 60)) console.log("  MODEL-ONLY", o.company, "|", (o.role ?? "").slice(0, 40), "|", o.events[0].type, "| sender", o.events[0].senderDomain);
process.exit(0);
