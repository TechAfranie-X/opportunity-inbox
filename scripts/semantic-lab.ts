/**
 * Semantic second reader lab. Development data only; aggregates only; blind sets are never loaded.
 *   node --env-file=.env.local --import ./scripts/loader/register.mjs scripts/semantic-lab.ts <labels.json>
 * The model outputs come from the shadow harness's cache of VERIFIED outputs (no inputs, no quotes) produced earlier by in-session
 * workers; nothing new is sent anywhere.
 */
import { readSnapshot } from "../lib/eval-store/snapshot.ts";
import { resolveBatch, } from "../lib/recruiting/entity/resolve.ts";
import { buildPredictions } from "../lib/recruiting/predictions.ts";
import { getCached } from "../lib/recruiting/reader/cache.ts";
import { buildReaderInput } from "../lib/recruiting/reader/redact.ts";
import { sameOrg } from "../lib/recruiting/reader/reconcile.ts";
import { sha } from "../lib/recruiting/reader/guide.ts";
import type { VerifiedOutput } from "../lib/recruiting/reader/types.ts";
import { DEV, loadDev, pct, type Msg } from "./lab-data.ts";
import { outcomeOf, runProduct } from "./lab-pipeline.ts";

const { messages } = loadDev(process.argv[2]);
const positives = messages.filter((m) => m.positive);
const selfNames = (process.env.READER_SELF_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// 1. Reconstruct each message's model input exactly as the shadow harness did, to find its cached verified output.
const model = new Map<string, { A: VerifiedOutput | null; B: VerifiedOutput | null }>();
for (const ds of DEV) {
  const { members, context } = readSnapshot(ds);
  const all = [...members, ...context];
  const res = resolveBatch(all.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, replyTo: e.replyTo, subject: e.subject, body: e.bodyText })));
  const perThread = new Map<string, number>();
  for (const m of all) perThread.set(m.threadId, (perThread.get(m.threadId) ?? 0) + 1);
  void buildPredictions;
  for (const m of members) {
    const r = res.get(m.id);
    const names: string[] = [];
    for (const n of [r?.entity?.name, ...(r?.alternatives ?? []).map((a) => a.name), ...(r?.evidence ?? []).filter((e) => e.weight >= 0.3).map((e) => e.name)]) if (n && !names.some((x) => sameOrg(x, n))) names.push(n);
    const input = buildReaderInput(m, `m${sha(`${ds}:${m.id}`).slice(0, 8)}`, names, perThread.get(m.threadId) ?? 1, selfNames);
    model.set(`${ds}|${m.id}`, { A: getCached(input, "A"), B: getCached(input, "B") });
  }
}
const read = messages.filter((m) => model.get(`${m.ds}|${m.id}`)?.A);
console.log(`dev messages ${messages.length} (recruiting ${positives.length}); cached model outputs found for ${read.length} (recruiting among them ${read.filter((m) => m.positive).length}); self-names configured: ${selfNames.length > 0}`);

// 2. The model reader on its own (development, guide v2 was written after seeing failures: optimistic)
const mv = (m: Msg, slot: "A" | "B") => model.get(`${m.ds}|${m.id}`)![slot];
const abst = (o: VerifiedOutput | null) => !o || o.status !== "ok" || o.certainty === "low";
for (const slot of ["A", "B"] as const) {
  const yes = messages.filter((m) => { const o = mv(m, slot); return o && !abst(o) && o.recruiting; });
  const tp = yes.filter((m) => m.positive).length;
  const abstained = messages.filter((m) => abst(mv(m, slot)));
  console.log(`MODEL run ${slot}: says recruiting ${yes.length} (true ${tp}, false ${yes.length - tp}); recall ${tp}/${positives.length} (${pct(tp, positives.length)}); abstained ${abstained.length} (of which recruiting ${abstained.filter((m) => m.positive).length})`);
}
const agree = messages.filter((m) => { const a = mv(m, "A"), b = mv(m, "B"); return a && b && !abst(a) && !abst(b) && a.recruiting === b.recruiting; }).length;
console.log(`  run A and run B give the same non-abstaining answer on ${agree} of ${messages.length}`);

// 3. What the product shows today, versus the model
const evs = await runProduct(messages);
const cell = (pos: boolean, outcomes: string[], ms: (o: VerifiedOutput | null) => boolean) => messages.filter((m) => m.positive === pos && outcomes.includes(outcomeOf(m, evs)) && ms(mv(m, "A"))).length;
const yesM = (o: VerifiedOutput | null) => !!o && !abst(o) && o.recruiting;
const noM = (o: VerifiedOutput | null) => !!o && !abst(o) && !o.recruiting;
const abM = (o: VerifiedOutput | null) => abst(o);
console.log("\nPRODUCT TODAY x MODEL (run A). Rows: what the product shows; columns: model says yes / no / abstains");
for (const [label, pos, outs] of [
  ["recruiting message, shown as fact          ", true, ["event"]], ["recruiting message, in review            ", true, ["event+review"]],
  ["recruiting message, strong near-miss       ", true, ["near-strong"]], ["recruiting message, weak near-miss         ", true, ["near-weak"]],
  ["recruiting message, SILENT                 ", true, ["none"]],
  ["not recruiting, shown as fact (SILENT FP)  ", false, ["event"]], ["not recruiting, in review               ", false, ["event+review"]],
  ["not recruiting, near-miss (noise)          ", false, ["near-strong", "near-weak"]],
] as Array<[string, boolean, string[]]>) console.log(`${label} yes ${String(cell(pos, outs, yesM)).padStart(3)}  no ${String(cell(pos, outs, noM)).padStart(3)}  abstain ${String(cell(pos, outs, abM)).padStart(3)}`);

// 4. Consensus policies on top of the current reliability layer (development data; the model's guide was written after seeing failures, so optimistic)
type Surface = "event" | "event+review" | "near-counted" | "near-folded" | "none";
function simulate(policy: "baseline" | "consensus" | "consensus-strict") {
  let silentMiss = 0, surfacedMiss = 0, foundFact = 0, foundReview = 0, silentFp = 0, visibleFp = 0, countedNoise = 0, foldedNoise = 0, trueFlagged = 0;
  for (const m of messages) {
    const base = outcomeOf(m, evs);
    const o = mv(m, "A");
    const my = yesM(o), mn = noM(o);
    let s: Surface = base === "event" ? "event" : base === "event+review" ? "event+review" : base === "near-strong" ? "near-counted" : base === "near-weak" ? "near-folded" : "none";
    if (policy !== "baseline") {
      if (s === "none" && my) s = "near-counted"; // the second reader recognises it, the first did not: ask a person
      if (s === "near-weak" as never) s = s;
      if (s === "near-counted" && mn && base === "near-strong") s = policy === "consensus-strict" ? "near-folded" : "near-counted"; // heuristic yes, model no
      if (s === "near-folded" && my) s = "near-counted";
      if (s === "event" && mn) s = "event+review"; // the model disagrees with a confident event: visible doubt
    }
    if (m.positive) {
      if (s === "none") silentMiss += 1; else if (s === "near-counted" || s === "near-folded") surfacedMiss += 1; else if (s === "event") foundFact += 1; else { foundReview += 1; trueFlagged += 1; }
    } else {
      if (s === "event") silentFp += 1; else if (s === "event+review") visibleFp += 1; else if (s === "near-counted") countedNoise += 1; else if (s === "near-folded") foldedNoise += 1;
    }
  }
  return { policy, found: foundFact + foundReview, silentMiss, surfacedMiss, silentFp, visibleFp, silentErrors: silentMiss + silentFp, trueFlagged, countedNoise, foldedNoise };
}
console.log("\nCONSENSUS POLICIES (silent error = recruiting message nobody sees + non-recruiting message shown as fact)");
for (const p of ["baseline", "consensus", "consensus-strict"] as const) { const r = simulate(p); console.log(`${r.policy.padEnd(17)} found in pipeline ${r.found}/77 | misses: silent ${r.silentMiss}, surfaced ${r.surfacedMiss} | false positives: silent ${r.silentFp}, in review ${r.visibleFp} | SILENT ERRORS ${r.silentErrors} | review items: true events ${r.trueFlagged}, counted noise ${r.countedNoise}, folded noise ${r.foldedNoise}`); }

// 5. LOCAL STATISTICAL READER: leave-one-dataset-out (train on two development datasets, score the third)
import { features, score, train } from "./semantic/lab/statistical.ts";
const feat = new Map(messages.map((m) => [`${m.ds}|${m.id}`, features(m)]));
const lodo = new Map<string, number>();
for (const held of DEV) {
  const model2 = train(messages.filter((m) => m.ds !== held).map((m) => ({ x: feat.get(`${m.ds}|${m.id}`)!, y: m.positive ? 1 : 0 })));
  for (const m of messages.filter((x) => x.ds === held)) lodo.set(`${m.ds}|${m.id}`, score(model2, feat.get(`${m.ds}|${m.id}`)!));
}
const sc = (m: Msg) => lodo.get(`${m.ds}|${m.id}`)!;
// AUC
{
  const pos = positives.map(sc), neg = messages.filter((m) => !m.positive).map(sc);
  let wins = 0; for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  console.log(`\nSTATISTICAL READER (leave-one-dataset-out) AUC ${(wins / (pos.length * neg.length)).toFixed(3)}`);
  const modelAuc = (() => { let w = 0; const p = positives; const n = messages.filter((m) => !m.positive); const s = (m: Msg) => { const o = mv(m, "A"); return o && !abst(o) ? (o.recruiting ? 1 : 0) : 0.5; }; for (const a of p) for (const b of n) w += s(a) > s(b) ? 1 : s(a) === s(b) ? 0.5 : 0; return w / (p.length * n.length); })();
  console.log(`  (the cached model reader as a 3-level score: AUC ${modelAuc.toFixed(3)})`);
}
for (const t of [0.5, 0.7, 0.85, 0.95]) {
  const yes = messages.filter((m) => sc(m) >= t);
  const tp = yes.filter((m) => m.positive).length;
  const silent = positives.filter((m) => outcomeOf(m, evs) === "none");
  console.log(`  threshold ${t}: says recruiting ${yes.length} (true ${tp}); of the product's ${silent.length} silent misses it recognises ${silent.filter((m) => sc(m) >= t).length}; of the ${messages.filter((m) => !m.positive && outcomeOf(m, evs) === "event").length} silent false positives it would doubt (score below ${(1 - t).toFixed(2)}): ${messages.filter((m) => !m.positive && outcomeOf(m, evs) === "event" && sc(m) < 0.2).length}`);
}

// 6. Review budget: among messages the product shows NOTHING for, rank by each second reader and see how many of the silent misses land in the top K
{
  const silentPool = messages.filter((m) => outcomeOf(m, evs) === "none");
  const silentMiss = silentPool.filter((m) => m.positive).length;
  const modelScore = (m: Msg) => { const o = mv(m, "A"); if (!o || o.status !== "ok") return 0; return (o.recruiting ? 1 : 0) * (o.certainty === "high" ? 2 : o.certainty === "medium" ? 1.5 : 1); };
  const rank = (f: (m: Msg) => number, K: number) => [...silentPool].sort((a, b) => f(b) - f(a)).slice(0, K).filter((m) => m.positive).length;
  console.log(`\nREVIEW BUDGET: among ${silentPool.length} messages the product shows nothing for, ${silentMiss} are recruiting. Silent misses captured in the top K:`);
  console.log("  K     statistical   model(A)   statistical+model");
  for (const K of [3, 5, 10, 20, 40]) console.log(`  ${String(K).padStart(2)}    ${String(rank(sc, K)).padStart(6)}        ${String(rank(modelScore, K)).padStart(5)}      ${String(rank((m) => modelScore(m) + sc(m), K)).padStart(6)}`);
  const modelYes = silentPool.filter((m) => modelScore(m) > 0);
  console.log(`  (the model says yes on ${modelYes.length} of them: ${modelYes.filter((m) => m.positive).length} true, ${modelYes.length - modelYes.filter((m) => m.positive).length} false)`);
}

// 7. Unfamiliar phrasing: train on ALL development data, score the synthetic holdout/stress sets (never used for training)
import { HOLDOUT, STRESS } from "../lib/reliability/stress-set.ts";
{
  const all = train(messages.map((m) => ({ x: feat.get(`${m.ds}|${m.id}`)!, y: m.positive ? 1 : 0 })));
  for (const [name, set] of [["HOLDOUT", HOLDOUT], ["STRESS (development set)", STRESS]] as const) {
    const pos = set.filter((s) => s.truth === "recruiting").map((s) => score(all, features(s.email))), neg = set.filter((s) => s.truth === "not").map((s) => score(all, features(s.email)));
    let w = 0; for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0;
    const f = (a: number[], t: number) => a.filter((x) => x >= t).length;
    console.log(`\nSYNTHETIC ${name}: statistical reader trained on development data: AUC ${(w / (pos.length * neg.length)).toFixed(3)}; recruiting scoring >=0.5: ${f(pos, 0.5)}/${pos.length}, >=0.2: ${f(pos, 0.2)}/${pos.length}; non-recruiting scoring >=0.5: ${f(neg, 0.5)}/${neg.length}, >=0.2: ${f(neg, 0.2)}/${neg.length}`);
  }
}

// 8. ON-DEVICE EMBEDDING READER (Apple NaturalLanguage sentence embeddings + logistic regression)
import { trainDense, scoreDense } from "./semantic/lab/dense.ts";
import { embedMany } from "./semantic/lab/embedding.ts";
{
  const synth = [...HOLDOUT.map((s) => ({ ...s, set: "HOLDOUT" })), ...STRESS.map((s) => ({ ...s, set: "STRESS" }))];
  const vecs = embedMany([
    ...messages.map((m) => ({ id: `d|${m.ds}|${m.id}`, subject: m.subject, body: m.bodyText })),
    ...synth.map((s, i) => ({ id: `s|${i}`, subject: s.email.subject, body: s.email.bodyText })),
  ]);
  if (!vecs) { console.log("\nEMBEDDING READER: helper not available (set OI_EMBED_BIN)"); }
  else {
    const V = (m: Msg) => vecs.get(`d|${m.ds}|${m.id}`)!;
    const lodoE = new Map<string, number>();
    for (const held of DEV) {
      const mdl = trainDense(messages.filter((m) => m.ds !== held).map((m) => ({ x: V(m), y: m.positive ? 1 : 0 })));
      for (const m of messages.filter((x) => x.ds === held)) lodoE.set(`${m.ds}|${m.id}`, scoreDense(mdl, V(m)));
    }
    const se = (m: Msg) => lodoE.get(`${m.ds}|${m.id}`)!;
    const neg = messages.filter((m) => !m.positive);
    let w = 0; for (const p of positives) for (const n of neg) w += se(p) > se(n) ? 1 : se(p) === se(n) ? 0.5 : 0;
    console.log(`\nEMBEDDING READER (leave-one-dataset-out) AUC ${(w / (positives.length * neg.length)).toFixed(3)}`);
    const silentPool = messages.filter((m) => outcomeOf(m, evs) === "none");
    console.log(`  silent misses (of ${silentPool.filter((m) => m.positive).length}) in the top K of ${silentPool.length} un-surfaced messages: ` + [5, 10, 20, 40].map((K) => `K=${K}: ${[...silentPool].sort((a, b) => se(b) - se(a)).slice(0, K).filter((m) => m.positive).length}`).join("  "));
    const all = trainDense(messages.map((m) => ({ x: V(m), y: m.positive ? 1 : 0 })));
    for (const set of ["HOLDOUT", "STRESS"]) {
      const items = synth.map((s, i) => ({ s, i })).filter((x) => x.s.set === set);
      const pos = items.filter((x) => x.s.truth === "recruiting").map((x) => scoreDense(all, vecs.get(`s|${x.i}`)!)), ng = items.filter((x) => x.s.truth === "not").map((x) => scoreDense(all, vecs.get(`s|${x.i}`)!));
      let ww = 0; for (const p of pos) for (const n of ng) ww += p > n ? 1 : p === n ? 0.5 : 0;
      const f = (a: number[], t: number) => a.filter((x) => x >= t).length;
      console.log(`  SYNTHETIC ${set}: AUC ${(ww / (pos.length * ng.length)).toFixed(3)}; recruiting >=0.5: ${f(pos, 0.5)}/${pos.length}, >=0.2: ${f(pos, 0.2)}/${pos.length}; non-recruiting >=0.5: ${f(ng, 0.5)}/${ng.length}, >=0.2: ${f(ng, 0.2)}/${ng.length}`);
    }
  }
}

// 9. Thread context: do the remaining silent errors sit in threads where the product already recognised another message?
{
  const threadHasEvent = (m: Msg) => messages.some((o) => o.ds === m.ds && o.threadId === m.threadId && o.id !== m.id && ["event", "event+review"].includes(outcomeOf(o, evs)));
  const silentMiss = positives.filter((m) => outcomeOf(m, evs) === "none");
  const silentFp = messages.filter((m) => !m.positive && outcomeOf(m, evs) === "event");
  const multi = (m: Msg) => messages.filter((o) => o.ds === m.ds && o.threadId === m.threadId).length > 1;
  console.log(`\nTHREAD CONTEXT: silent misses ${silentMiss.length}: in a multi-message thread ${silentMiss.filter(multi).length}, in a thread where another message is already an event ${silentMiss.filter(threadHasEvent).length}; silent false positives ${silentFp.length}: in a multi-message thread ${silentFp.filter(multi).length}`);
}

// 10. THE IMPLEMENTED CONSENSUS through the real engine (privacy triage included): opinions served by id from the cached verified outputs,
//     but only for messages that pass the veto-only triage, exactly the ones a reader would be allowed to see.
import type { SemanticReader } from "../lib/semantic/port.ts";
{
  const byId = new Map(messages.map((m) => [m.id, mv(m, "A")]));
  const reader: SemanticReader = { id: "dev-cache", async opine(inputs) { return new Map(inputs.flatMap((i) => { const o = byId.get(i.key); return o ? [[i.key, o] as const] : []; })); } };
  const withModel = await runProduct(messages, undefined, reader);
  const score2 = (label: string, e2: typeof evs) => {
    let silentMiss = 0, surfaced = 0, silentFp = 0, trueFlagged = 0, countedNoise = 0, foldedNoise = 0, found = 0;
    for (const m of messages) {
      const o = outcomeOf(m, e2);
      if (m.positive) { if (o === "none") silentMiss += 1; else if (o === "near-strong" || o === "near-weak") surfaced += 1; else { found += 1; if (o === "event+review") trueFlagged += 1; } }
      else if (o === "event") silentFp += 1; else if (o === "near-strong") countedNoise += 1; else if (o === "near-weak") foldedNoise += 1;
    }
    console.log(`${label.padEnd(34)} in pipeline ${found}/77 | misses: silent ${silentMiss}, surfaced ${surfaced} | silent false positives ${silentFp} | SILENT ERRORS ${silentMiss + silentFp} | review: true events flagged ${trueFlagged}, counted noise ${countedNoise}, folded noise ${foldedNoise}`);
  };
  console.log("\nIMPLEMENTED CONSENSUS, real engine (development data; the model's guide was written after seeing failures, so optimistic):");
  score2("reliability layer alone", evs);
  score2("+ second reader (dev cache)", withModel);
}
