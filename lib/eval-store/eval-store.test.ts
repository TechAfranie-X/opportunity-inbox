import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { RecruitingEmail } from "../recruiting/types.ts";
import { datasetDir, evalDir, listDatasets, modeOf, purgeLocal, writePrivateFile } from "./private-fs.ts";
import { freezeLocal, manifestHash, readSnapshot, sampleIds, verifyFrozen, writeSnapshot, type Manifest } from "./snapshot.ts";
import { parseLabelsJsonl, toJsonl } from "./labels-io.ts";

let root: string;
before(() => { root = mkdtempSync(join(tmpdir(), "oi-eval-")); process.env.OI_EVAL_DIR = join(root, "store", "eval"); });
after(() => { delete process.env.OI_EVAL_DIR; rmSync(root, { recursive: true, force: true }); });

const email = (id: string, thread = `t-${id}`, body = "SECRET BODY TEXT"): RecruitingEmail => ({ id, threadId: thread, from: "Acme <jobs@acme.com>", subject: "Hello", receivedAt: new Date("2026-03-01T10:00:00Z"), outbound: false, bodyText: body });
const manifest = (name: string, ids: string[]): Manifest => ({
  name, kind: "dev_random", createdAt: "2026-03-01T00:00:00.000Z", frozenAt: null, manifestHash: null, asOf: "2026-03-01T09:00:00.000Z", account: "test",
  memberIds: ids, contextIds: [], missing: [], sampling: { method: "random", seed: "s", universeSize: 10, universeQuery: "q", universeHash: "h" },
});

test("sampling is uniform-ish, reproducible from the seed alone, and never exceeds the universe", () => {
  const universe = Array.from({ length: 1000 }, (_, i) => `id${i}`);
  const a = sampleIds(universe, 100, "seed-1");
  assert.deepEqual(a, sampleIds([...universe].reverse(), 100, "seed-1")); // order of the universe does not matter
  assert.notDeepEqual(a, sampleIds(universe, 100, "seed-2"));
  assert.equal(new Set(a).size, 100);
  assert.equal(sampleIds(["a", "b"], 10, "x").length, 2);
  // a fair sample touches every part of the universe, not just its start
  const idx = a.map((id) => Number(id.slice(2)));
  assert.ok(Math.max(...idx) > 800 && Math.min(...idx) < 200);
});

test("the store is private: directory 0700, files 0600, outside any repo", () => {
  writeSnapshot(manifest("priv-a", ["m1", "m2"]), [email("m1"), email("m2")], []);
  assert.equal(modeOf(evalDir()), 0o700);
  assert.equal(modeOf(datasetDir("priv-a")), 0o700);
  assert.equal(modeOf(join(datasetDir("priv-a"), "messages.jsonl")), 0o600);
  assert.equal(modeOf(join(datasetDir("priv-a"), "manifest.json")), 0o600);
  assert.ok(!evalDir().includes("/opportunity-inbox/"), "eval store must not live inside the project");
});

test("snapshot round-trips members and context with dates revived", () => {
  writeSnapshot(manifest("round", ["m1"]), [email("m1")], [email("c1", "t-m1")]);
  const s = readSnapshot("round");
  assert.equal(s.members.length, 1);
  assert.equal(s.context.length, 1);
  assert.ok(s.members[0].receivedAt instanceof Date);
  assert.equal(s.members[0].bodyText, "SECRET BODY TEXT");
});

test("freeze records the hash, makes files read-only, and verification detects tampering", () => {
  writeSnapshot(manifest("frz", ["m1", "m2", "m3"]), [email("m1"), email("m2"), email("m3")], []);
  const frozen = freezeLocal("frz", new Date("2026-03-02T00:00:00Z"));
  assert.equal(frozen.manifestHash, manifestHash(["m3", "m1", "m2"]));
  assert.equal(modeOf(join(datasetDir("frz"), "messages.jsonl")), 0o400);
  assert.equal(verifyFrozen("frz").frozenAt, "2026-03-02T00:00:00.000Z");
  assert.throws(() => freezeLocal("frz"), /already frozen/);
  // tamper: drop a member from the snapshot file
  writePrivateFile(join(datasetDir("frz"), "messages.jsonl"), readFileSync(join(datasetDir("frz"), "messages.jsonl"), "utf8").split("\n").slice(1).join("\n"));
  assert.throws(() => verifyFrozen("frz"), /missing from the snapshot/);
});

test("a message that could not be fetched stays in the dataset definition and is not replaced", () => {
  const m = { ...manifest("miss", ["m1", "m2"]), missing: ["m2"] };
  writeSnapshot(m, [email("m1")], []);
  freezeLocal("miss");
  assert.equal(verifyFrozen("miss").memberIds.length, 2);
});

test("purge removes frozen (read-only) snapshots, one dataset or everything", () => {
  assert.ok(listDatasets().includes("frz"));
  assert.ok(purgeLocal("frz") > 0);
  assert.equal(existsSync(datasetDir("frz")), false);
  assert.ok(listDatasets().length > 0);
  assert.ok(purgeLocal() > 0);
  assert.equal(existsSync(evalDir()), false);
  assert.equal(purgeLocal(), 0);
});

test("dataset names cannot escape the store", () => {
  for (const bad of ["../x", "a/b", "Up", "x", ""]) assert.throws(() => datasetDir(bad), /dataset name/);
});

const ctx = { kind: "dev_random" as const, memberIds: new Set(["m1", "m2"]), defaultLabeler: "me" };

test("label import accepts valid rows and tags them with the dataset's human source", () => {
  const text = [
    JSON.stringify({ gmailMessageId: "m1", field: "is_recruiting", value: true }),
    JSON.stringify({ gmailMessageId: "m1", field: "type", value: "assessment", labeler: "reviewer-1" }),
    JSON.stringify({ gmailMessageId: "m1", field: "company", value: "unknown" }),
    JSON.stringify({ gmailMessageId: "m1", field: "role", value: "not_applicable" }),
    JSON.stringify({ gmailMessageId: "m2", field: "event_date", value: "2026-03-05" }),
    JSON.stringify({ gmailMessageId: "m2", field: "urgency", value: "today" }),
  ].join("\n");
  const { rows, errors } = parseLabelsJsonl(text, ctx);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.source === "dev_human"));
  assert.equal(rows[1].labeler, "reviewer-1");
  assert.equal(rows[0].labeler, "me");
  assert.equal(parseLabelsJsonl(text.replace(/"unknown"/, '"Acme"'), { ...ctx, kind: "blind" }).rows[0].source, "blind_human");
});

test("label import rejects anything that could anchor or corrupt ground truth", () => {
  const bad = (o: object, c = ctx) => parseLabelsJsonl(JSON.stringify(o), c).errors[0];
  assert.match(bad({ gmailMessageId: "m1", field: "company", value: "A", prediction: "B" }), /unexpected key.*prediction/);
  assert.match(bad({ gmailMessageId: "m1", field: "type", value: "predicted_by_model", predictedType: "x" }), /unexpected key/);
  assert.match(bad({ gmailMessageId: "zz", field: "company", value: "A" }), /not a member/);
  assert.match(bad({ gmailMessageId: "m1", field: "nope", value: "A" }), /unknown field/);
  assert.match(bad({ gmailMessageId: "m1", field: "type", value: "not-a-type" }), /invalid value/);
  assert.match(bad({ gmailMessageId: "m1", field: "is_recruiting", value: "yes" }), /invalid value/);
  assert.match(bad({ gmailMessageId: "m1", field: "event_date", value: "next tuesday" }), /invalid value/);
  assert.match(bad({ gmailMessageId: "m1", field: "company", value: "A", labeler: "me@example.com" }), /opaque tag/);
  assert.match(bad({ gmailMessageId: "m1", field: "company", value: "A", source: "legacy_reconstructed" }), /not allowed for a dev_random/);
  assert.match(bad({ gmailMessageId: "m1", field: "company", value: "A", source: "dev_human" }, { ...ctx, kind: "blind" }), /not allowed for a blind/);
  assert.match(parseLabelsJsonl("{not json", ctx).errors[0], /not valid JSON/);
});

test("DEV-CHALLENGE may carry legacy and correction labels; the others may not", () => {
  const row = { gmailMessageId: "m1", field: "company", value: "A", source: "legacy_reconstructed" };
  assert.deepEqual(parseLabelsJsonl(JSON.stringify(row), { ...ctx, kind: "dev_challenge" }).errors, []);
  assert.equal(parseLabelsJsonl(JSON.stringify({ ...row, source: "blind_human" }), { ...ctx, kind: "dev_challenge" }).errors.length, 1);
});

test("exported labels contain only label fields: no content, no predictions", () => {
  const out = toJsonl([{ gmailMessageId: "m1", field: "company", value: "Acme", labeler: "me", source: "dev_human", createdAt: new Date("2026-03-01T00:00:00Z") }]);
  assert.deepEqual(Object.keys(JSON.parse(out)).sort(), ["createdAt", "field", "gmailMessageId", "labeler", "source", "value"]);
});

test("a stored snapshot is the only place bodies exist: manifest.json carries none", () => {
  writeSnapshot(manifest("nobody", ["m1"]), [email("m1", "t1", "TOP SECRET")], []);
  assert.ok(!readFileSync(join(datasetDir("nobody"), "manifest.json"), "utf8").includes("TOP SECRET"));
  assert.ok(readdirSync(datasetDir("nobody")).sort().join() === "manifest.json,messages.jsonl");
});

test("the default location is under the user's home, never inside the working tree", async () => {
  const saved = process.env.OI_EVAL_DIR;
  delete process.env.OI_EVAL_DIR;
  const { homedir } = await import("node:os");
  const dir = evalDir();
  process.env.OI_EVAL_DIR = saved;
  assert.equal(dir, join(homedir(), ".opportunity-inbox", "eval"));
  assert.ok(!dir.startsWith(process.cwd()));
});
