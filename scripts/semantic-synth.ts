/**
 * Semantic reader on SYNTHETIC mail only (the hand-written holdout and stress sets: fictional employers, no real email text).
 *   export:  node ... scripts/semantic-synth.ts export <dir>      writes redacted inputs + guide for an in-session worker
 *   score:   node ... scripts/semantic-synth.ts score <dir>       verifies the worker's outputs and compares with the product
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBatch } from "../lib/recruiting/entity/resolve.ts";
import { sameOrg } from "../lib/recruiting/reader/reconcile.ts";
import { GUIDE_V2, OUTPUT_SPEC } from "../lib/recruiting/reader/guide.ts";
import { buildReaderInput } from "../lib/recruiting/reader/redact.ts";
import { verifyOutput } from "../lib/recruiting/reader/verify.ts";
import { eventNeedsReview } from "../lib/recruiting/opportunity.ts";
import { readMail } from "../lib/reliability/assess.ts";
import { isNearMiss, isWeakNearMiss } from "../lib/reliability/flags.ts";
import { HOLDOUT, STRESS } from "../lib/reliability/stress-set.ts";

const [cmd, dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: semantic-synth.ts export|score <dir>");
const all = [...HOLDOUT.map((s) => ({ ...s, set: "HOLDOUT" })), ...STRESS.map((s) => ({ ...s, set: "STRESS" }))];
const res = resolveBatch(all.map((s) => ({ id: s.email.id, threadId: s.email.threadId, from: s.email.from, replyTo: undefined, subject: s.email.subject, body: s.email.bodyText })));
const input = (s: (typeof all)[number], i: number) => {
  const r = res.get(s.email.id);
  const names: string[] = [];
  for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name)]) if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
  return buildReaderInput(s.email, `s${i}`, names, 1, []);
};

if (cmd === "export") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "batch-0.jsonl"), all.map((s, i) => JSON.stringify(input(s, i))).join("\n") + "\n");
  writeFileSync(join(dir, "guide.md"), `${GUIDE_V2}\n## Output format\n${OUTPUT_SPEC}\n`);
  writeFileSync(join(dir, "truth.json"), JSON.stringify(all.map((s, i) => ({ key: `s${i}`, set: s.set, name: s.name, truth: s.truth }))));
  console.log(`exported ${all.length} synthetic messages`);
} else {
  void readFileSync(join(dir, "truth.json"), "utf8"); // the truth is read by the scorer below only through the synthetic sets themselves
  const outs = new Map<string, ReturnType<typeof verifyOutput>>();
  for (const f of readdirSync(dir).filter((x) => /^out-\d+\.jsonl$/.test(x))) for (const line of readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)) {
    try { const raw = JSON.parse(line); const i = Number(String(raw.key).slice(1)); if (all[i]) outs.set(raw.key, verifyOutput(raw, input(all[i], i))); } catch { /* skip */ }
  }
  console.log(`worker outputs verified: ${outs.size} of ${all.length}`);
  for (const set of ["HOLDOUT", "STRESS"]) {
    let rec = 0, recYes = 0, recAbst = 0, neg = 0, negYes = 0, prodSilent = 0, prodFact = 0;
    let recSilentAfter = 0, negSilentAfter = 0, recRescued = 0;
    all.forEach((s, i) => {
      if (s.set !== set) return;
      const o = outs.get(`s${i}`);
      const my = !!o && o.status === "ok" && o.certainty !== "low" && o.recruiting;
      const [e] = readMail([s.email]);
      const surface = !e ? "none" : isNearMiss(e) ? (isWeakNearMiss(e) ? "weak" : "strong") : eventNeedsReview({ ...e, id: "x", corrected: false } as never) || !e.company ? "review" : "event";
      if (s.truth === "recruiting") {
        rec += 1; if (my) recYes += 1; if (!o || o.status !== "ok" || o.certainty === "low") recAbst += 1;
        if (surface === "none") { prodSilent += 1; if (my) recRescued += 1; else recSilentAfter += 1; }
      } else {
        neg += 1; if (my) negYes += 1;
        if (surface === "event") { prodFact += 1; if (!(o && o.status === "ok" && !o.recruiting)) negSilentAfter += 1; }
      }
    });
    console.log(`${set}: recruiting ${rec}: model says yes ${recYes} (abstained ${recAbst}); product silent ${prodSilent}, model rescues ${recRescued}, still silent ${recSilentAfter}. Non-recruiting ${neg}: model says yes ${negYes}; product shows as fact ${prodFact}, still unflagged after the model ${negSilentAfter}`);
  }
}
