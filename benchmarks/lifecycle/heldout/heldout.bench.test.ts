import test from "node:test";
import { check } from "../check.ts";
import { observe, pairwise } from "../harness.ts";
import { generateHeldout, HELDOUT_SEED, HELDOUT_SIZE } from "./generate.ts";

/** SEALED: run only at milestone gates. One test per expectation, plus aggregate pairwise metrics printed as METRIC lines. */
const cases = generateHeldout();
for (const c of cases) {
  const o = observe(c.events, c.company, c.now);
  for (const f of c.facets) test(`[${f.cat}] HELDOUT ${c.id}: ${f.kind} - ${f.why}`, () => check(c, o, f));
}

test("[grouping] HELDOUT aggregate: pairwise grouping over every scenario's full truth", () => {
  const truth: string[][] = [], pred: string[][] = [];
  for (const c of cases) {
    const o = observe(c.events, c.company, c.now);
    truth.push(...(c.truth ?? []));
    const byGroup = new Map<number, string[]>();
    for (const e of c.events) { const g = o.groupOf(e.id); (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(e.id); }
    pred.push(...byGroup.values());
  }
  const m = pairwise(truth, pred);
  console.log(`METRIC ${JSON.stringify({ set: "heldout-synthetic", seed: HELDOUT_SEED, scenarios: HELDOUT_SIZE, ...m })}`);
});
