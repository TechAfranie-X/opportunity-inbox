import type { LabelField, LabelSource } from "../recruiting/ground-truth.ts";

/**
 * Label arithmetic for the labeling tool: the latest human value per (message, field) among the allowed sources.
 *
 * This is a deliberate copy of `resolveLabels` in lib/recruiting/evaluator.ts. The labeling tool must be structurally
 * unable to reach prediction code, and importing the evaluator pulls the extractor into its import graph. lib/recruiting
 * is frozen for blind-1-amended, so the copy lives here instead; resolve-labels.test.ts fails if the two ever disagree.
 */
export type LabelRow = {
  gmailMessageId: string;
  field: LabelField;
  value: unknown;
  source: LabelSource;
  createdAt: Date | string | number;
};

export function resolveLabels(rows: LabelRow[], sources: LabelSource[]) {
  const allowed = new Set(sources);
  const latest = new Map<string, { at: number; seq: number; value: unknown }>();
  rows.forEach((row, seq) => {
    if (!allowed.has(row.source)) return;
    const key = `${row.gmailMessageId}\u0000${row.field}`;
    const at = new Date(row.createdAt).getTime();
    const cur = latest.get(key);
    if (!cur || at > cur.at || (at === cur.at && seq > cur.seq)) latest.set(key, { at, seq, value: row.value });
  });
  const byMessage = new Map<string, Partial<Record<LabelField, unknown>>>();
  for (const [key, { value }] of latest) {
    const [id, field] = key.split("\u0000");
    const m = byMessage.get(id) ?? {};
    m[field as LabelField] = value;
    byMessage.set(id, m);
  }
  return byMessage;
}
