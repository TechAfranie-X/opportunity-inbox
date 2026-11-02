import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The local evaluation store holds raw message bodies so evaluations are reproducible. It therefore lives
 * OUTSIDE the repository and OUTSIDE Postgres, is readable only by the local user (dirs 0700, files 0600), and is
 * never read by product serving code. `OI_EVAL_DIR` overrides the location (used by tests).
 */
export function evalDir(): string {
  return process.env.OI_EVAL_DIR ?? join(homedir(), ".opportunity-inbox", "eval");
}

const NAME = /^[a-z0-9][a-z0-9-]{1,48}$/;
export function assertDatasetName(name: string) {
  if (!NAME.test(name)) throw new Error(`dataset name must be lowercase letters, digits and dashes (2-49 chars): "${name}"`);
  return name;
}

export function datasetDir(name: string) {
  return join(evalDir(), assertDatasetName(name));
}

/** Create a directory (and its missing parents under the store) readable only by the current user. */
export function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask and skipped for existing dirs: enforce it.
  chmodSync(dir, 0o700);
  const parent = join(dir, "..");
  if (parent.endsWith(".opportunity-inbox")) chmodSync(parent, 0o700);
}

export function writePrivateFile(path: string, data: string | Buffer) {
  if (existsSync(path)) chmodSync(path, 0o600); // a frozen (read-only) file may be rewritten only by an explicit caller
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export const modeOf = (path: string) => statSync(path).mode & 0o777;

export function listDatasets(): string[] {
  const dir = evalDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && NAME.test(e.name)).map((e) => e.name).sort();
}

/** Delete one dataset's local content, or the whole store. Returns the number of files removed. */
export function purgeLocal(dataset?: string): number {
  const target = dataset ? datasetDir(dataset) : evalDir();
  if (!existsSync(target)) return 0;
  const count = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
  const n = count(target);
  // Frozen snapshots are read-only: make them removable first.
  const unlock = (d: string) => {
    chmodSync(d, 0o700);
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) unlock(p); else chmodSync(p, 0o600);
    }
  };
  unlock(target);
  rmSync(target, { recursive: true, force: true });
  return n;
}
