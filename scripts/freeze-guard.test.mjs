import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { FREEZE_TAG, FROZEN_PATHS, needsGuard, verifyFrozen } from "./freeze-guard.mjs";

const repo = resolve(import.meta.dirname, "..");
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A scratch checkout of the freeze tag, removed afterwards. */
function withTagCheckout(fn) {
  const dir = mkdtempSync(join(tmpdir(), "freeze-guard-"));
  git(repo, "worktree", "add", "--detach", dir, `refs/tags/${FREEZE_TAG}`);
  try { return fn(dir); } finally { git(repo, "worktree", "remove", "--force", dir); rmSync(dir, { recursive: true, force: true }); }
}

test("needsGuard: only evidence-writing commands, and dry runs of collect/label-set are exempt", () => {
  for (const c of ["collect", "export", "import", "label-set", "analyze"]) assert.equal(needsGuard(c, []), true, c);
  for (const c of ["status", "report", "review", "power", "synthetic-run", "freeze-check"]) assert.equal(needsGuard(c, []), false, c);
  assert.equal(needsGuard("collect", ["--user", "x", "--dry-run"]), false);
  assert.equal(needsGuard("label-set", ["--dry-run"]), false);
  assert.equal(needsGuard("analyze", ["--dry-run"]), true, "the analysis has no dry-run exemption");
  assert.equal(needsGuard("export", ["--dry-run"]), true);
  assert.equal(needsGuard(undefined, []), false);
});

test("the freeze tag exists and the frozen paths all exist at it", () => {
  assert.ok(git(repo, "rev-parse", `refs/tags/${FREEZE_TAG}`));
  for (const p of FROZEN_PATHS) assert.ok(git(repo, "ls-tree", `refs/tags/${FREEZE_TAG}`, p), `${p} missing at the tag`);
});

test("a pristine checkout of the tag verifies", () => {
  withTagCheckout((dir) => assert.deepEqual(verifyFrozen(dir), { ok: true, reasons: [] }));
});

test("editing frozen product code, adding a file to a frozen path, or staging a change each fail verification", () => {
  withTagCheckout((dir) => {
    appendFileSync(join(dir, "lib/recruiting/extract.ts"), "\n// edit\n");
    const r = verifyFrozen(dir);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(" "), /lib\/recruiting\/extract\.ts/);
  });
  withTagCheckout((dir) => {
    writeFileSync(join(dir, "lib/gmail/extra.ts"), "export {};\n");
    const r = verifyFrozen(dir);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(" "), /untracked files in frozen paths/);
  });
  withTagCheckout((dir) => {
    appendFileSync(join(dir, "lib/gmail/recruiting-source.ts"), "\n// widened query\n");
    git(dir, "add", "lib/gmail/recruiting-source.ts");
    assert.equal(verifyFrozen(dir).ok, false, "a staged change counts, not just a working-tree one");
  });
});

test("changes OUTSIDE the frozen paths do not trip the guard (docs, the product UI, new top-level files)", () => {
  withTagCheckout((dir) => {
    appendFileSync(join(dir, "docs/validation-mvp.md"), "\nnote\n");
    appendFileSync(join(dir, "app/globals.css"), "\n/* style */\n");
    writeFileSync(join(dir, "NOTES.md"), "x\n");
    assert.equal(verifyFrozen(dir).ok, true);
  });
});

test("the preload refuses an evidence-writing command from a modified checkout and lets everything else through", () => {
  const preload = join(repo, "scripts/freeze-guard-preload.mjs");
  const run = (dir, ...args) => spawnSync(process.execPath, ["--import", preload, join(dir, "noop.mjs"), ...args], { cwd: dir, encoding: "utf8" });
  withTagCheckout((dir) => {
    writeFileSync(join(dir, "noop.mjs"), "console.log('ran');\n");
    assert.equal(run(dir, "collect", "--user", "x").status, 0, "pristine checkout may collect");
    appendFileSync(join(dir, "lib/recruiting/extract.ts"), "\n// product change\n");
    const blocked = run(dir, "collect", "--user", "x");
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /not the frozen evaluation environment/);
    assert.doesNotMatch(blocked.stdout, /ran/, "the CLI never started");
    for (const c of [["analyze"], ["import", "--dir", "d"], ["export", "--out", "o"], ["label-set", "--user", "x"]]) assert.equal(run(dir, ...c).status, 2, c.join(" "));
    for (const c of [["status"], ["power"], ["report"], ["synthetic-run"], ["collect", "--user", "x", "--dry-run"], ["label-set", "--dry-run"]]) assert.equal(run(dir, ...c).status, 0, c.join(" "));
  });
});

test("the shadow script is wired through the guard", () => {
  const pkg = JSON.parse(execFileSync("cat", [join(repo, "package.json")], { encoding: "utf8" }));
  assert.match(pkg.scripts.shadow, /--import \.\/scripts\/freeze-guard-preload\.mjs/);
});
