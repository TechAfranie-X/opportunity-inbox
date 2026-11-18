#!/usr/bin/env node
/**
 * Lifecycle integrity benchmark runner (test-only; touches no data, no network, no evaluation store).
 *   node scripts/lifecycle-bench.mjs                   run the development benchmark; exit 1 while anything fails (the honest state of the product)
 *   node scripts/lifecycle-bench.mjs --check           ratchet for CI: exit 0 only if the failures are exactly the recorded known failures (no new failure, no stale entry)
 *   node scripts/lifecycle-bench.mjs --update-known    rewrite benchmarks/lifecycle/known-failures.json from the current results (a deliberate act, reviewed in the diff)
 *   node scripts/lifecycle-bench.mjs --heldout         ALSO run the sealed synthetic held-out set (milestone gates only; never tune against it)
 *   node scripts/lifecycle-bench.mjs --list            list failing cases only
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { run } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const files = [join(root, "benchmarks/lifecycle/dev/lifecycle.bench.test.ts"), join(root, "benchmarks/lifecycle/dev/ingestion.bench.test.ts")];
if (flags.has("--heldout")) files.push(join(root, "benchmarks/lifecycle/heldout/heldout.bench.test.ts"));
const knownFile = join(root, "benchmarks/lifecycle/known-failures.json");

const results = new Map(); // name -> "pass" | "fail" | "todo"
const metrics = [];
const stream = run({ files, concurrency: false });
stream.on("test:pass", (e) => { if (e.nesting === 0 && e.name && !e.name.endsWith(".ts")) results.set(e.name, e.todo ? "todo" : "pass"); });
stream.on("test:fail", (e) => { if (e.nesting === 0 && e.name && !e.name.endsWith(".ts")) results.set(e.name, e.todo ? "todo" : "fail"); });
stream.on("test:stdout", (e) => { for (const line of String(e.message).split("\n")) if (line.startsWith("METRIC ")) metrics.push(JSON.parse(line.slice(7))); });
stream.on("test:stderr", () => {});
await new Promise((resolve) => { stream.on("end", resolve); stream.resume(); });

const cat = (name) => /^\[([\w-]+)\]/.exec(name)?.[1] ?? "other";
const by = new Map();
for (const [name, r] of results) { const c = cat(name); const row = by.get(c) ?? { pass: 0, fail: 0, todo: 0 }; row[r]++; by.set(c, row); }
const failing = [...results].filter(([, r]) => r === "fail").map(([n]) => n).sort();

const neverKnown = failing.filter((n) => /^\[(regression|dormancy|idempotency)\]/.test(n));
if (flags.has("--update-known") && neverKnown.length) {
  console.error(`refusing to record: these must never fail (they are the cases the audit found correct, the dormancy exceptions and idempotency):\n${neverKnown.map((n) => `  ✖ ${n}`).join("\n")}`);
  process.exit(2);
}
if (flags.has("--update-known")) {
  writeFileSync(knownFile, JSON.stringify({ note: "Failing tests at the recorded baseline. A test leaves this list only when it passes. `--check` fails on new failures and on entries that now pass.", failing }, null, 1) + "\n");
  console.log(`recorded ${failing.length} known failures in ${knownFile}`);
}

const total = [...results.values()];
console.log(`\nLifecycle integrity benchmark: ${total.filter((r) => r === "pass").length} pass, ${total.filter((r) => r === "fail").length} FAIL, ${total.filter((r) => r === "todo").length} pending (of ${total.length})${flags.has("--heldout") ? " (development + sealed held-out)" : " (development)"}\n`);
console.log("category          pass  fail  pending");
for (const [c, r] of [...by].sort()) console.log(`${c.padEnd(17)} ${String(r.pass).padStart(4)}  ${String(r.fail).padStart(4)}  ${String(r.todo).padStart(7)}`);

const rate = (c, pattern) => { const all = [...results].filter(([n]) => cat(n) === c && pattern.test(n)); const names = all.filter(([, r]) => r !== "todo"); const f = names.filter(([, r]) => r === "fail").length; return { n: names.length, f, pending: all.length - names.length }; };
const line = (label, x, want) => console.log(`${label.padEnd(50)} ${x.n - x.f}/${x.n} ok${x.pending ? ` (+${x.pending} pending)` : ""}   target ${want}`);
console.log("\nAcceptance criteria (development set; targets from the audit):");
line("cross-season / cross-program merges avoided", rate("grouping", /cannotLink/), "100% (0 merges)");
line("lifecycles kept whole (must-links)", rate("grouping", /mustLink/), "100%");
line("terminal evidence ends or flags the lifecycle", { n: [...results].filter(([n]) => cat(n) === "terminal").length, f: [...results].filter(([n, r]) => cat(n) === "terminal" && r === "fail").length }, "100%");
line("current role/title from the latest source", rate("role", /./), "100%");
line("explicit-deadline accuracy (ingestion)", rate("deadline", /./), ">= 99%");
line("action recall (offer/onboarding/interviews)", rate("actions", /./), "100%");
line("contradictions surfaced in review", rate("review", /./), "100%");
line("non-recruiting mail kept out of the pipeline", rate("false-positive", /./), "100%");
line("idempotency (one event per message, stable replay)", rate("idempotency", /./), "100%");
line("presentation (no mojibake)", rate("presentation", /./), "100%");
line("regression safety (cases the audit found correct)", rate("regression", /./), "100% (must never fail)");
line("dormancy exceptions preserved", rate("dormancy", /./), "100% (must never fail)");
for (const m of metrics) console.log(`\nheld-out (${m.set}, seed ${m.seed}): pairwise grouping precision ${(m.precision * 100).toFixed(1)}%, recall ${(m.recall * 100).toFixed(1)}%, wrong merges ${m.wrongMerges}, missed links ${m.missedLinks}`);

if (failing.length && !flags.has("--check") || flags.has("--list")) {
  console.log(`\nFailing (${failing.length}):`);
  for (const n of failing) console.log(`  ✖ ${n}`);
}

if (flags.has("--check")) {
  const known = existsSync(knownFile) ? JSON.parse(readFileSync(knownFile, "utf8")).failing : [];
  const regress = failing.filter((n) => !known.includes(n));
  const stale = known.filter((n) => results.get(n) === "pass" || !results.has(n));
  if (regress.length) console.log(`\nNEW FAILURES (${regress.length}):\n${regress.map((n) => `  ✖ ${n}`).join("\n")}`);
  if (stale.length) console.log(`\nNow passing: remove from known-failures.json with --update-known (${stale.length}):\n${stale.map((n) => `  ✔ ${n}`).join("\n")}`);
  process.exit(regress.length || stale.length ? 1 : 0);
}
process.exit(failing.length ? 1 : 0);
