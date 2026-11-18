// Read-only: the actions Today would build for one stored account (company, kind, sentence).
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
for (const a of ws.actions) console.log(JSON.stringify({ k: a.kind, c: (a as { company?: string }).company, t: (a as { title?: string }).title, u: (a as { urgency?: string }).urgency }));
console.log(ws.actions.length, "actions;", ws.possible.length, "possible");
process.exit(0);
