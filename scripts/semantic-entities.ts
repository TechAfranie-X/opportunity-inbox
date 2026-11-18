/**
 * Entity-understanding evaluation on the SYNTHETIC set (lib/semantic/entity-set.ts). No real mail, no database.
 *   export <dir>  writes the redacted inputs the model would receive (inputs.json) and the guide (guide.txt)
 *   score  <dir>  reads <dir>/out.json (the model's raw readings), verifies and reconciles them, and compares with the deterministic product
 * The baseline is the production reader (readMail: rules + reliability layer). The semantic arm adds consensus and employer reconciliation exactly
 * as the sync engine does. Aggregates and per-case ids only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMail } from "../lib/reliability/assess.ts";
import { sameOrg } from "../lib/recruiting/reader/reconcile.ts";
import { applyConsensus } from "../lib/semantic/consensus.ts";
import { reconcileReadings } from "../lib/semantic/employer.ts";
import { ENTITY_CASES, caseToEmail } from "../lib/semantic/entity-set.ts";
import { SEMANTIC_GUIDE } from "../lib/semantic/guide-v2.ts";
import { semanticInputs } from "../lib/semantic/inputs.ts";
import { verifyReading, type VerifiedReading } from "../lib/semantic/reading.ts";
import type { ExtractedEvent } from "../lib/recruiting/types.ts";

const [mode, dir] = process.argv.slice(2);
const emails = ENTITY_CASES.map(caseToEmail);
const inputs = semanticInputs(emails, ["Sam"]);

if (mode === "export") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify(inputs.map((i) => ({ key: i.key, from: i.from, subject: i.subject, body: i.body, received: i.received, employer_candidates: i.candidates.map((c) => c.name) })), null, 1));
  writeFileSync(join(dir, "guide.txt"), SEMANTIC_GUIDE);
  console.log(`exported ${inputs.length} inputs of ${ENTITY_CASES.length} cases (the rest are vetoed by the local triage and never sent)`);
  process.exit(0);
}

const baseline = new Map<string, ExtractedEvent>();
for (const e of readMail(emails)) baseline.set(e.gmailMessageId, e);

const raw: Array<Record<string, unknown>> = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
const byKey = new Map(raw.map((r) => [String(r.key), r]));
const readings = new Map<string, VerifiedReading>();
const rejected: Record<string, number> = {};
for (const i of inputs) {
  const v = verifyReading(byKey.get(i.key), i);
  for (const r of v.rejections) rejected[r.split(":").slice(0, 2).join(":")] = (rejected[r.split(":").slice(0, 2).join(":")] ?? 0) + 1;
  readings.set(i.key, v);
}
const opinions = new Map([...readings].map(([k, v]) => [k, v.output] as const));
const semantic = new Map<string, ExtractedEvent>();
for (const e of reconcileReadings(applyConsensus([...baseline.values()], emails, opinions), readings)) semantic.set(e.gmailMessageId, e);

const isNear = (e: ExtractedEvent) => e.signals.includes("near_miss") || e.signals.includes("near_miss_weak");
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function measure(label: string, ev: Map<string, ExtractedEvent>) {
  let pos = 0, found = 0, silent = 0, fp = 0, neg = 0;
  let empAsk = 0, empRight = 0, empWrong = 0, empUnknown = 0, nullTruthFalse = 0, nullTruth = 0, likely = 0;
  let roleAsk = 0, roleRight = 0, typeAsk = 0, typeRight = 0, review = 0;
  const wrongs: string[] = [];
  for (const c of ENTITY_CASES) {
    const e = ev.get(c.id);
    const shown = !!e && !isNear(e); // a near miss is asked about, not shown as an opportunity
    if (c.truth.recruiting) {
      pos++;
      if (shown) found++; else if (!e) silent++;
      if (!shown) continue;
      if (c.truth.employer) {
        empAsk++;
        if (!e!.company) empUnknown++;
        else if (sameOrg(e!.company, c.truth.employer)) empRight++;
        else { empWrong++; wrongs.push(`${c.id}:${e!.company}`); }
      } else { nullTruth++; if (e!.company) { nullTruthFalse++; wrongs.push(`${c.id}:${e!.company}(truth none)`); } }
      if (e!.company && (e!.fieldConfidence?.company ?? e!.confidence) < 0.6) likely++;
      if (c.truth.role) { roleAsk++; if (e!.role && norm(e!.role).includes(norm(c.truth.role).split(" ")[0]) && norm(c.truth.role).split(" ").every((w) => norm(e!.role).includes(w))) roleRight++; }
      if (c.truth.type) { typeAsk++; if (e!.type === c.truth.type) typeRight++; }
      if ((e!.reviewReasons ?? []).length > 0 || (e!.fieldConfidence?.company ?? 1) < 0.6) review++;
    } else {
      neg++;
      if (shown) fp++;
    }
  }
  const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "n/a");
  console.log(`\n${label}`);
  console.log(`  recruiting shown        ${pct(found, pos)}   silent misses ${silent}   false positives ${fp}/${neg}`);
  console.log(`  employer (truth named)  right ${pct(empRight, empAsk)}  unknown ${empUnknown}  WRONG ${empWrong}`);
  console.log(`  employer (truth none)   invented ${nullTruthFalse}/${nullTruth}`);
  console.log(`  role right              ${pct(roleRight, roleAsk)}   event type right ${pct(typeRight, typeAsk)}`);
  console.log(`  shown as likely (not known) ${likely}   events asked about (company or reason) ${review}`);
  if (wrongs.length) console.log(`  wrong/invented: ${wrongs.join(", ")}`);
}
measure("deterministic product (rules + reliability layer)", baseline);
measure("deterministic + semantic reader (verified, reconciled)", semantic);
console.log("\nverifier rejections:", JSON.stringify(rejected));
// the reader on its own, before reconciliation
let rRight = 0, rEmp = 0, rEmpAsk = 0, rEmpWrong = 0, rNullInvented = 0, rUnsup = 0;
for (const c of ENTITY_CASES) {
  const v = readings.get(c.id);
  if (!v) continue;
  if (v.output.status === "unsupported_yes") rUnsup++;
  if (v.output.status !== "ok" || v.output.certainty === "low") continue;
  if (v.output.recruiting === c.truth.recruiting) rRight++;
  if (c.truth.recruiting && c.truth.employer) { rEmpAsk++; if (v.employer && sameOrg(v.employer.name, c.truth.employer)) rEmp++; else if (v.employer) rEmpWrong++; }
  if (c.truth.recruiting && !c.truth.employer && v.employer) rNullInvented++;
}
console.log(`reader alone: recruiting call right ${rRight}/${inputs.length} (${rUnsup} unsupported yes); verified employer right ${rEmp}/${rEmpAsk}, wrong ${rEmpWrong}, invented where none ${rNullInvented}`);
