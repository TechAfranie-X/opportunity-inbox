// Read-only: lists what the Review "Possibly recruiting" section holds for one account (sender domain and subject only; no bodies exist in storage).
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
const why = (e: { signals: string[] }) => (e.signals.includes("sweep-weak (refined)") ? "sweep-weak" : e.signals.includes("near-miss:weak") ? "near-miss:weak" : "near-miss:strong");
const by = new Map<string, number>();
for (const e of ws.possible) by.set(why(e), (by.get(why(e)) ?? 0) + 1);
console.log(ws.possible.length, "possible;", Object.fromEntries(by));
if (process.argv[3] === "--list") for (const e of ws.possible) console.log(why(e).padEnd(15), (e.senderDomain || "").padEnd(28).slice(0, 28), e.subject.slice(0, 60));
process.exit(0);
