import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDir, writePrivateFile } from "../../eval-store/private-fs.ts";
import { READER_VERSION, sha } from "./guide.ts";
import type { ReaderInput, VerifiedOutput } from "./types.ts";

/**
 * Cache of VERIFIED model outputs. Keyed by (reader version, input hash, run slot). It never stores the model's input or
 * any quote text: evidence is a hash plus an offset. Slots let one input be read twice to measure determinism.
 */
export const cacheDir = () => process.env.READER_CACHE_DIR ?? join(homedir(), ".opportunity-inbox", "eval", "reader-cache", READER_VERSION);

export function inputHash(input: ReaderInput): string {
  return sha(JSON.stringify({ f: input.from, s: input.subject, b: input.body, r: input.received, t: input.threadMessages, c: input.candidates.map((c) => c.name) })).slice(0, 24);
}

const file = (hash: string, slot: string) => join(cacheDir(), `${hash}.${slot}.json`);

export function putCached(input: ReaderInput, slot: string, out: VerifiedOutput) {
  ensurePrivateDir(cacheDir());
  writePrivateFile(file(inputHash(input), slot), JSON.stringify({ version: READER_VERSION, slot, output: { ...out, key: undefined } }));
}

export function getCached(input: ReaderInput, slot: string): VerifiedOutput | null {
  const path = file(inputHash(input), slot);
  if (!existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, "utf8"));
  return j.version === READER_VERSION ? { ...j.output, key: input.key } : null;
}
