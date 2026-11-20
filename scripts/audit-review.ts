// Read-only: the Review queue of one stored account, by tier and by reason (plain-language reasons only; no message text). Usage: audit-review.ts <googleSub>
import { buildReviewQueue } from "../lib/recruiting/review.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
const ws = await loadWorkspace(process.argv[2]);
const q = buildReviewQueue(ws.opportunities, undefined, ws.possible);
const tier = (i: (typeof q)[number]) => (i.weak ? "suggestion" : i.tier === "important" ? "important" : "housekeeping");
const by = new Map<string, number>();
for (const i of q) by.set(`${tier(i)} | ${i.reasons[0]?.slice(0, 80) ?? "(no reason)"}`, (by.get(`${tier(i)} | ${i.reasons[0]?.slice(0, 80) ?? "(no reason)"}`) ?? 0) + 1);
console.log(`total ${q.length}: important ${q.filter((i) => tier(i) === "important").length}, housekeeping ${q.filter((i) => tier(i) === "housekeeping").length}, suggestions ${q.filter((i) => tier(i) === "suggestion").length}`);
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(3), k);
process.exit(0);
