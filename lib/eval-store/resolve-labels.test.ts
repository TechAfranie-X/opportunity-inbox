import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import test from "node:test";
import { resolveLabels as evaluatorResolveLabels } from "../recruiting/evaluator.ts";
import { resolveLabels, type LabelRow } from "./resolve-labels.ts";

const root = normalize(join(import.meta.dirname, "../.."));

test("the labeler's resolveLabels agrees with the evaluator's on superseded, mixed-source and tied rows", () => {
  const t = (n: number) => new Date(1_700_000_000_000 + n);
  const rows: LabelRow[] = [
    { gmailMessageId: "a", field: "is_recruiting", value: true, source: "blind_human", createdAt: t(1) },
    { gmailMessageId: "a", field: "is_recruiting", value: false, source: "blind_human", createdAt: t(2) },
    { gmailMessageId: "a", field: "type", value: "interview", source: "blind_human", createdAt: t(2) },
    { gmailMessageId: "a", field: "type", value: "offer", source: "blind_human", createdAt: t(2) },
    { gmailMessageId: "a", field: "company", value: "X", source: "dev_human", createdAt: t(5) },
    { gmailMessageId: "b", field: "role", value: "Intern", source: "blind_human", createdAt: t(3).toISOString() },
  ];
  for (const sources of [["blind_human"], ["dev_human"], ["blind_human", "dev_human"]] as const) {
    assert.deepEqual([...resolveLabels(rows, [...sources])], [...evaluatorResolveLabels(rows, [...sources])]);
  }
});

/** Every local module the labeling tool can reach, following relative imports (value and type) transitively. */
function reachable(entry: string) {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(join(root, file), "utf8");
    for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const next = normalize(join(dirname(file), m[1]));
      if (existsSync(join(root, next))) queue.push(next);
    }
  }
  return seen;
}

// The anchoring guarantee, stated on the whole import graph: nothing that can produce or load a prediction is reachable.
test("the labeling tool's transitive imports reach no extractor, prediction, evaluator, reader or Gmail code", () => {
  const graph = [...reachable("scripts/label-server.ts")];
  const forbidden = /(^|\/)(extract|predictions|evaluator|policy|signals|company|role|dates|opportunity|product|briefing|history|store|sync|metrics|recruiting-source|reader\/.*)\.ts$/;
  assert.deepEqual(graph.filter((f) => forbidden.test(f)), []);
  assert.ok(!graph.some((f) => f.startsWith("lib/recruiting/reader/") || f.startsWith("lib/gmail/")));
});
