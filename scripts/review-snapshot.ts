/** Read-only: the current Review queue as structured rows (ids, kinds, reasons; no message text). node ... scripts/review-snapshot.ts <sub> [--tier important|routine|weak] */
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { reviewOptions } from "../lib/recruiting/product-config.ts";
import { buildReviewQueue } from "../lib/recruiting/review.ts";
const sub = process.argv[2]; const tier = process.argv.includes("--tier") ? process.argv[process.argv.indexOf("--tier") + 1] : "important";
const ws = await loadWorkspace(sub, new Date());
const q = buildReviewQueue(ws.opportunities, undefined, ws.possible, new Date(), reviewOptions());
const pick = q.filter((i) => (tier === "weak" ? i.weak : !i.weak && (tier === "important" ? i.tier === "important" : i.tier !== "important")));
console.log(`${pick.length} ${tier} items`);
for (const i of pick) console.log(`${i.event.gmailMessageId.slice(0, 8)} ${i.event.occurredAt.toISOString().slice(2, 10)} ${(i.kind ?? "").padEnd(16)} ${i.event.type.padEnd(15)} ${i.company.slice(0, 22).padEnd(22)} | ${(i.role ?? "-").slice(0, 26).padEnd(26)} | ${i.reasons.map((r) => r.slice(0, 70)).join(" / ")}`);
process.exit(0);
