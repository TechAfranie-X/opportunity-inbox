// Read-only: opportunities typed as non-job for one stored account.
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
for (const o of ws.opportunities.filter((x) => x.kind && x.kind !== "job")) console.log(`${o.kind} | ${o.company} | ${o.role ?? "-"} | ${o.events.map((e) => e.subject.slice(0, 40)).join(" / ").slice(0, 110)}`);
process.exit(0);
