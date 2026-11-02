import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DATASET_KINDS, HEADLINE_SOURCES, LABEL_FIELDS, LABEL_SOURCES, SOURCE_FOR_DATASET } from "./ground-truth.ts";

// The SQL check constraints and this vocabulary must not drift apart.
const sql = readFileSync(new URL("../../drizzle/0002_ground_truth.sql", import.meta.url), "utf8");
const listIn = (constraint: string) => {
  const m = new RegExp(`CONSTRAINT "${constraint}" CHECK \\([^)]*in \\(([^)]*)\\)`).exec(sql);
  assert.ok(m, `constraint ${constraint} not found in migration`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
};

test("label sources, fields and dataset kinds match the database constraints", () => {
  assert.deepEqual(listIn("labels_source_check"), [...LABEL_SOURCES].sort());
  assert.deepEqual(listIn("labels_field_check"), [...LABEL_FIELDS].sort());
  assert.deepEqual(listIn("eval_datasets_kind_check"), [...DATASET_KINDS].sort());
});

test("only fresh human labels count toward headline metrics", () => {
  assert.deepEqual([...HEADLINE_SOURCES].sort(), ["blind_human", "dev_human"]);
  assert.equal(HEADLINE_SOURCES.includes("legacy_reconstructed"), false);
  assert.equal(HEADLINE_SOURCES.includes("user_correction"), false);
});

test("every dataset kind maps to a headline label source", () => {
  for (const kind of DATASET_KINDS) assert.ok(HEADLINE_SOURCES.includes(SOURCE_FOR_DATASET[kind]));
  assert.equal(SOURCE_FOR_DATASET.blind, "blind_human");
});
