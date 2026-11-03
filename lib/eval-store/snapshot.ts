import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetKind } from "../recruiting/ground-truth.ts";
import type { RecruitingEmail } from "../recruiting/types.ts";
import { assertDatasetName, datasetDir, ensurePrivateDir, writePrivateFile } from "./private-fs.ts";

/**
 * A dataset on disk: `messages.jsonl` (members + thread context, WITH bodies) and `manifest.json`.
 * Members are what gets labeled and scored; context messages are thread-mates kept so the extractor sees the
 * same thread context it would in production, but they are never labeled or scored.
 */
export type Manifest = {
  name: string;
  kind: DatasetKind;
  createdAt: string;
  frozenAt: string | null;
  manifestHash: string | null;
  /** The reference "now" urgency labels are made against, as a floating date (UTC fields = wall clock). */
  asOf: string;
  /** Opaque tag for the mailbox ("dev-mailbox", "blind-1"). Never an address. */
  account: string;
  memberIds: string[];
  contextIds: string[];
  /** Members that could not be fetched. They stay in the dataset's definition: failures are never replaced. */
  missing: string[];
  sampling: { method: "random" | "curated"; seed: string | null; universeSize: number | null; universeQuery: string | null; universeHash: string | null;
    /** Datasets whose messages (members and thread context) were removed from the universe before sampling, so the sets cannot overlap. */
    excludedDatasets?: string[]; excludedCount?: number } | null;
};

type StoredMessage = Omit<RecruitingEmail, "receivedAt"> & { receivedAt: string; role: "member" | "context" };

export const manifestHash = (memberIds: string[]) => createHash("sha256").update([...memberIds].sort().join("\n")).digest("hex");

const paths = (name: string) => ({ dir: datasetDir(name), messages: join(datasetDir(name), "messages.jsonl"), manifest: join(datasetDir(name), "manifest.json") });

export function writeSnapshot(manifest: Manifest, members: RecruitingEmail[], context: RecruitingEmail[]) {
  assertDatasetName(manifest.name);
  const p = paths(manifest.name);
  ensurePrivateDir(p.dir);
  const rows: StoredMessage[] = [
    ...members.map((m) => ({ ...m, receivedAt: m.receivedAt.toISOString(), role: "member" as const })),
    ...context.map((m) => ({ ...m, receivedAt: m.receivedAt.toISOString(), role: "context" as const })),
  ];
  writePrivateFile(p.messages, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeManifest(manifest);
}

export function writeManifest(manifest: Manifest) {
  writePrivateFile(paths(manifest.name).manifest, JSON.stringify(manifest, null, 2) + "\n");
}

export function readManifest(name: string): Manifest {
  const p = paths(name);
  if (!existsSync(p.manifest)) throw new Error(`no local snapshot for dataset "${name}" (looked in ${p.dir})`);
  return JSON.parse(readFileSync(p.manifest, "utf8")) as Manifest;
}

export function readSnapshot(name: string): { manifest: Manifest; members: RecruitingEmail[]; context: RecruitingEmail[] } {
  const manifest = readManifest(name);
  const members: RecruitingEmail[] = [];
  const context: RecruitingEmail[] = [];
  for (const line of readFileSync(paths(name).messages, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const { role, receivedAt, ...rest } = JSON.parse(line) as StoredMessage;
    (role === "member" ? members : context).push({ ...rest, receivedAt: new Date(receivedAt) });
  }
  return { manifest, members, context };
}

/** Freeze: record the manifest hash and make the snapshot files read-only. Idempotent only if nothing changed. */
export function freezeLocal(name: string, now = new Date()): Manifest {
  const manifest = readManifest(name);
  if (manifest.frozenAt) throw new Error(`dataset "${name}" is already frozen`);
  const frozen = { ...manifest, frozenAt: now.toISOString(), manifestHash: manifestHash(manifest.memberIds) };
  writeManifest(frozen);
  const p = paths(name);
  chmodSync(p.messages, 0o400);
  chmodSync(p.manifest, 0o400);
  return frozen;
}

/** Integrity check: the snapshot on disk must still match the frozen manifest. Throws with a specific reason. */
export function verifyFrozen(name: string): Manifest {
  const { manifest, members } = readSnapshot(name);
  if (!manifest.frozenAt || !manifest.manifestHash) throw new Error(`dataset "${name}" is not frozen`);
  if (manifestHash(manifest.memberIds) !== manifest.manifestHash) throw new Error(`dataset "${name}": member list no longer matches its frozen hash`);
  const onDisk = new Set(members.map((m) => m.id));
  const absent = manifest.memberIds.filter((id) => !onDisk.has(id) && !manifest.missing.includes(id));
  if (absent.length > 0) throw new Error(`dataset "${name}": ${absent.length} member message(s) are missing from the snapshot`);
  return manifest;
}

/** Seeded PRNG (mulberry32) so a sample is reproducible from (universe, n, seed) alone. */
function prng(seed: string) {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniform random sample without replacement. The universe is sorted first, so the result depends only on
 * the set of ids, n and the seed. There is deliberately no "resample" or "replace" operation: failures stay.
 */
export function sampleIds(universe: string[], n: number, seed: string): string[] {
  const pool = [...new Set(universe)].sort();
  const rand = prng(seed);
  const k = Math.min(n, pool.length);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k).sort();
}
