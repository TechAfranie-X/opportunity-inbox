/**
 * Leave-one-out reconstruction on the LIVE workspace (label-free generalisation check, not tuned on the 22 development cases): for a seeded sample of events that sit in well-evidenced applications
 * (3+ messages, rule-found, not a class message), take the event OUT of its application, hand it to the investigator as a lone message, and see whether it returns to where the product had put it.
 * The product's own grouping is the pseudo-truth, so this measures self-consistency and ambiguity, not accuracy: "resolved elsewhere" cases are the ones to inspect (a critical cross-journey merge
 * if the investigator is wrong, a product error if it is right). Read-only.   node ... scripts/journey-loo.ts <googleSub> [--n 300] [--seed s]
 */
import { createHash } from "node:crypto";
import { reconstructJourney } from "../lib/investigate/journey.ts";
import { identityContext } from "../lib/recruiting/product-config.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import type { Opportunity } from "../lib/recruiting/types.ts";
const sub = process.argv[2]; const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const N = Number(arg("--n", "300")), seed = arg("--seed", "loo-1");
let h = createHash("sha256").update(seed).digest().readUInt32LE(0);
const rnd = () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ws = await loadWorkspace(sub, new Date());
const pool = ws.opportunities.filter((o) => o.events.length >= 3 && o.kind === "job").flatMap((o) => o.events.slice(1).filter((e) => !e.outbound && !e.corrected && !e.confirmed && !e.signals.includes("semantic:event") && !e.signals.some((s) => s.startsWith("class:"))).map((e) => ({ e, o })));
const sample = [...pool].sort(() => rnd() - 0.5).slice(0, N);
const unplace = (id: string): Opportunity[] => ws.opportunities.flatMap((o) => { const e = o.events.find((x) => x.gmailMessageId === id); return e ? [{ ...o, events: o.events.filter((x) => x !== e) }, { ...o, key: `${o.key}~u`, events: [e], status: "active", stage: "applied", outcome: null, closedBy: null } as Opportunity] : [o]; });
const tally = { same: 0, elsewhere: 0, sibling: 0, ambiguous: 0, none: 0 }; const byType = new Map<string, { n: number; same: number; elsewhere: number; amb: number }>(); const elsewhere: string[] = [];
for (const { e, o } of sample) {
  const j = reconstructJourney(e.gmailMessageId, { opportunities: unplace(e.gmailMessageId), ctx: identityContext() }); const t = byType.get(e.type) ?? { n: 0, same: 0, elsewhere: 0, amb: 0 }; t.n++; byType.set(e.type, t);
  if (!j) { tally.none++; continue; }
  if (j.decision === "ambiguous") { tally.ambiguous++; t.amb++; } else if (j.application?.key === o.key) { tally.same++; t.same++; } else if (j.application && j.application.company === o.company && (j.application.role ?? "") === (o.role ?? "")) { tally.sibling++; t.same++; } else { tally.elsewhere++; t.elsewhere++; elsewhere.push(`${e.gmailMessageId.slice(0, 8)} ${e.type.padEnd(12)} ${o.company.slice(0, 16).padEnd(16)} -> ${(j.application?.company ?? "-").slice(0, 16)}|${(j.application?.role ?? "-").slice(0, 22)} (was ${(o.role ?? "-").slice(0, 22)})`); }
}
const n = sample.length, pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;
console.log(`leave-one-out on ${n} events from ${new Set(sample.map((x) => x.o.key)).size} applications (pool ${pool.length}): returned to its application ${tally.same} (${pct(tally.same)}), resolved to a SIBLING with the same company and role (the product holds one journey in several identical groups: a product fragment, not an error) ${tally.sibling} (${pct(tally.sibling)}), resolved ELSEWHERE ${tally.elsewhere} (${pct(tally.elsewhere)}), ambiguous (one question) ${tally.ambiguous} (${pct(tally.ambiguous)})`);
for (const [k, v] of byType) console.log(`   ${k.padEnd(18)} n=${String(v.n).padStart(3)}  same ${v.same}  elsewhere ${v.elsewhere}  ambiguous ${v.amb}`);
for (const l of elsewhere.slice(0, 40)) console.log("   ELSEWHERE", l);
process.exit(0);
