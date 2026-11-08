// Freeze guard: provenance protection for the prospective evaluation (docs/prospective-evaluation-protocol.md).
//
// The evaluation's rows must be produced by exactly the frozen code. The final analysis compares only lib/recruiting and
// lib/opportunities with the tag, but COLLECTION also depends on lib/gmail (its keyword query defines the "current product"
// comparator), lib/db, lib/eval-store and the CLI itself. This module lets every evaluation-WRITING command verify, before
// it does anything, that the checkout it runs from is byte-identical to the freeze tag in all of those paths.
//
// It is a seatbelt against accidents (running `npm run shadow -- collect` from a product checkout), not a security boundary.
import { execFileSync } from "node:child_process";

export const FREEZE_TAG = "arch-v2-shadow-candidate-2";

/** Paths whose content defines the frozen candidate and its collection. */
export const FROZEN_PATHS = [
  "lib/recruiting", "lib/opportunities", "lib/gmail", "lib/db", "lib/eval-store", "drizzle",
  "scripts/shadow.ts", "scripts/loader",
];

/** Commands that write evaluation evidence or produce the result. Read-only commands and dry runs are always allowed. */
const WRITING = new Set(["collect", "export", "import", "label-set", "analyze"]);

export function needsGuard(cmd, flags = []) {
  if (!WRITING.has(cmd)) return false;
  const dry = flags.includes("--dry-run");
  return !(dry && (cmd === "collect" || cmd === "label-set"));
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };

/** Returns { ok, reasons[] }. `cwd` is the checkout to verify. */
export function verifyFrozen(cwd = process.cwd()) {
  const reasons = [];
  if (!tryGit(cwd, "rev-parse", "--verify", "--quiet", `refs/tags/${FREEZE_TAG}`)) {
    return { ok: false, reasons: [`the freeze tag ${FREEZE_TAG} is not present in this repository (git fetch --tags)`] };
  }
  // Tracked files, working tree and index, against the tag.
  const changed = tryGit(cwd, "diff", "--name-only", FREEZE_TAG, "--", ...FROZEN_PATHS);
  if (changed === null) reasons.push("could not compare the working tree with the freeze tag");
  else if (changed) reasons.push(`these files differ from ${FREEZE_TAG}:\n      ${changed.split("\n").join("\n      ")}`);
  // Untracked files in frozen paths (a new file can change behavior as surely as an edit).
  const untracked = tryGit(cwd, "ls-files", "--others", "--exclude-standard", "--", ...FROZEN_PATHS);
  if (untracked) reasons.push(`untracked files in frozen paths:\n      ${untracked.split("\n").join("\n      ")}`);
  return { ok: reasons.length === 0, reasons };
}

export function guardMessage(cmd, reasons) {
  return [
    `\nrefusing to run "shadow ${cmd}": this checkout is not the frozen evaluation environment.`,
    ...reasons.map((r) => `  - ${r}`),
    "",
    "Evaluation commands that write evidence must run from the evaluation checkout (the main branch, at the freeze tag).",
    "Product work lives on the `mvp` branch in its own worktree; see docs/development-workflow.md.",
    "",
  ].join("\n");
}
