/**
 * Reduces a second evaluator's verdicts to the DISPUTES the owner has to resolve. Reads the frozen labels and the downloaded validation-verdicts.json; prints only items the evaluator did not
 * agree with, with both opinions and the Gmail link. Items nobody disputes are never shown to the owner.   node ... scripts/validation-resolve.ts <verdicts.json>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const set = JSON.parse(readFileSync(`${homedir()}/.opportunity-inbox-validation/validation-v1.json`, "utf8")) as { account: string; items: { id: string; journey: string | null; expect: string; tag: string; note?: string }[] };
const v = JSON.parse(readFileSync(process.argv[2], "utf8")) as { verdicts: { id: string; verdict: string; note: string }[] };
const by = new Map(set.items.map((i) => [i.id, i]));
const rows = v.verdicts.filter((x) => x.verdict === "disagree" || x.verdict === "unsure");
const unanswered = v.verdicts.filter((x) => x.verdict === "unanswered").length;
console.log(`${v.verdicts.length} verdicts: ${v.verdicts.filter((x) => x.verdict === "agree").length} agree, ${rows.length} to resolve, ${unanswered} unanswered`);
for (const r of rows) { const i = by.get(r.id)!; console.log(`- ${i.journey ?? "NOT an application"} | label: ${i.journey ? i.expect : i.note} | evaluator: ${r.verdict}${r.note ? ` (${r.note})` : ""} | https://mail.google.com/mail/#all/${r.id}`); }
