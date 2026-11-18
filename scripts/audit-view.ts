// Read-only: prints the pipeline (company, role, stage, status) for one stored account. No message content is printed. Usage: audit-view.ts <googleSub>
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
const rows = ws.opportunities.map((o) => `${o.status === "closed" ? "closed" : o.stage.padEnd(9)} | ${o.company.slice(0, 26).padEnd(26)} | ${(o.role ?? "-").slice(0, 50).padEnd(50)} | ${o.events.length} ev`);
console.log(rows.join("\n"));
console.log(`${ws.opportunities.filter((o) => o.status === "active").length} active / ${ws.opportunities.filter((o) => o.status === "closed").length} closed`);
process.exit(0);
