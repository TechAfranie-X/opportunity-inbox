// Read-only: how much of the pipeline rests on model-created single events? Prints counts and company names only (no message text). Usage: audit-noise.ts <googleSub>
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
const modelOnly = (o: (typeof ws.opportunities)[number]) => o.events.every((e) => e.signals.includes("semantic:event"));
const single = ws.opportunities.filter((o) => o.events.length === 1);
const mo = ws.opportunities.filter(modelOnly);
const moSingleActive = mo.filter((o) => o.events.length === 1 && o.status === "active");
console.log(`opportunities=${ws.opportunities.length} active=${ws.opportunities.filter((o) => o.status === "active").length} single-event=${single.length} model-only=${mo.length} model-only-single-active=${moSingleActive.length}`);
const byType: Record<string, number> = {};
for (const o of moSingleActive) byType[o.stage] = (byType[o.stage] ?? 0) + 1;
console.log("model-only single active by stage:", JSON.stringify(byType));
console.log(moSingleActive.slice(0, 45).map((o) => `${o.stage}:${o.company.slice(0, 24)}`).join(" | "));
process.exit(0);
