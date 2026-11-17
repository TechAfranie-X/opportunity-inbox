import { spawnSync } from "node:child_process";

/**
 * Sentence embeddings from the on-device helper (scripts/embed/oi-embed.swift, macOS only). Nothing leaves the machine: the helper is a local
 * process reading stdin. Returns null when the helper is not available, so callers fall back to not having a second opinion.
 */
export type EmbedItem = { id: string; subject: string; body: string };

export function embedMany(items: EmbedItem[], bin = process.env.OI_EMBED_BIN): Map<string, number[]> | null {
  if (!bin) return null;
  const r = spawnSync(bin, { input: items.map((i) => JSON.stringify(i)).join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) return null;
  const out = new Map<string, number[]>();
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { id: string; vec: number[] };
    out.set(o.id, o.vec);
  }
  return out;
}
