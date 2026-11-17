/**
 * The on-device language model (Apple FoundationModels via scripts/semantic/oi-semantic.swift) as a second reader, on DEVELOPMENT data only.
 * Everything runs on this machine. Aggregates only.
 *   export <dir>   writes redacted, triaged inputs for the helper
 *   score  <dir>   verifies the helper's outputs and runs the real engine with them as the second reader
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDE_V2, OUTPUT_SPEC } from "../lib/recruiting/reader/guide.ts";
import { verifyOutput } from "../lib/recruiting/reader/verify.ts";
import type { VerifiedOutput } from "../lib/recruiting/reader/types.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import type { SemanticReader } from "../lib/semantic/port.ts";
import { loadDev } from "./lab-data.ts";
import { outcomeOf, runProduct } from "./lab-pipeline.ts";

const [cmd, dir, labels] = process.argv.slice(2);
const selfNames = (process.env.READER_SELF_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const { messages } = loadDev(labels);
const inputs = DEV_INPUTS();
function DEV_INPUTS() {
  // key = ds|id so two datasets never collide; the semantic key is the message id inside the engine, so index by both
  return messages.flatMap((m) => semanticInputs([m], selfNames).map((i) => ({ ...i, key: `${m.ds}|${m.id}` })));
}

if (cmd === "export") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "inputs.jsonl"), inputs.map((i) => JSON.stringify(i)).join("\n") + "\n");
  writeFileSync(join(dir, "guide.md"), `${GUIDE_V2}\n## Output format\n${OUTPUT_SPEC}\n`);
  console.log(`exported ${inputs.length} of ${messages.length} messages (the rest are vetoed by triage and never read)`);
} else {
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const verified = new Map<string, VerifiedOutput>();
  for (const f of readdirSync(dir).filter((x) => /^out.*\.jsonl$/.test(x))) for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
    try { const raw = JSON.parse(line); const inp = byKey.get(raw.key); if (inp) verified.set(raw.key, verifyOutput(raw, inp)); } catch { /* skip */ }
  }
  const stat = { ok: 0, invalid: 0, unsupported: 0, low: 0, yes: 0, yesHigh: 0 };
  for (const v of verified.values()) { if (v.status === "ok") stat.ok += 1; else if (v.status === "invalid") stat.invalid += 1; else stat.unsupported += 1; if (v.certainty === "low") stat.low += 1; if (v.status === "ok" && v.certainty !== "low" && v.recruiting) { stat.yes += 1; if (v.certainty === "high") stat.yesHigh += 1; } }
  console.log(`verified outputs ${verified.size}/${inputs.length}: ok ${stat.ok}, invalid ${stat.invalid}, unsupported yes ${stat.unsupported}, low certainty ${stat.low}; usable yes ${stat.yes} (high ${stat.yesHigh})`);
  const idToKey = new Map(messages.map((m) => [m.id, `${m.ds}|${m.id}`]));
  const policies: Array<[string, (v: VerifiedOutput) => boolean]> = [["any non-low certainty", () => true], ["high certainty only", (v) => v.certainty === "high"]];
  const base = await runProduct(messages);
  const score = (label: string, evs: typeof base) => {
    let silentMiss = 0, surfaced = 0, silentFp = 0, flagged = 0, counted = 0, folded = 0, found = 0;
    for (const m of messages) { const o = outcomeOf(m, evs); if (m.positive) { if (o === "none") silentMiss += 1; else if (o.startsWith("near")) surfaced += 1; else { found += 1; if (o === "event+review") flagged += 1; } } else if (o === "event") silentFp += 1; else if (o === "near-strong") counted += 1; else if (o === "near-weak") folded += 1; }
    console.log(`${label.padEnd(30)} in pipeline ${found}/77 | misses: silent ${silentMiss}, surfaced ${surfaced} | silent FP ${silentFp} | SILENT ERRORS ${silentMiss + silentFp} | review: true events flagged ${flagged}, counted noise ${counted}, folded ${folded}`);
  };
  score("reliability layer alone", base);
  for (const [name, keep] of policies) {
    const reader: SemanticReader = { id: "apple", async opine(ins) { return new Map(ins.flatMap((i) => { const v = verified.get(idToKey.get(i.key) ?? ""); return v && keep(v) ? [[i.key, v] as const] : []; })); } };
    score(`+ on-device model (${name})`, await runProduct(messages, undefined, reader));
  }
}
