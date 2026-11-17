/**
 * Shared loader for the reliability experiments: DEVELOPMENT datasets only (dev-random-1, validation-1, validation-2), read
 * from the local evaluation store outside the repo, with a labels export. blind-* datasets are never loaded.
 * Experiments print aggregates only (no subject, sender, body or id).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RecruitingEmail } from "../lib/recruiting/types.ts";

export const DEV = ["dev-random-1", "validation-1", "validation-2"] as const;
const root = join(homedir(), ".opportunity-inbox", "eval");

export type LabelRow = { ds: string; id: string; field: string; value: unknown };
export type Msg = RecruitingEmail & { ds: string; labels: string[]; positive: boolean; type?: string; stage?: string; company?: string; role?: string; opp?: string };

export function loadDev(labelsFile: string) {
  const rows = JSON.parse(readFileSync(labelsFile, "utf8")) as LabelRow[];
  const gmailLabels = JSON.parse(readFileSync(join(root, "dev-gmail-labels.json"), "utf8")) as Record<string, string[]>;
  const by = (field: string) => new Map(rows.filter((r) => r.field === field).map((r) => [`${r.ds}|${r.id}`, r.value]));
  const rec = by("is_recruiting"), type = by("type"), stage = by("stage"), company = by("company"), role = by("role"), opp = by("opportunity_ref");
  const messages: Msg[] = [];
  for (const ds of DEV) {
    const manifest = JSON.parse(readFileSync(join(root, ds, "manifest.json"), "utf8")) as { memberIds: string[] };
    const members = new Set(manifest.memberIds);
    for (const line of readFileSync(join(root, ds, "messages.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const m = JSON.parse(line) as RecruitingEmail & { receivedAt: string };
      if (!members.has(m.id) || m.outbound) continue;
      const k = `${ds}|${m.id}`;
      const s = (v: unknown) => (typeof v === "string" ? v : undefined);
      messages.push({ ...m, receivedAt: new Date(m.receivedAt), ds, labels: gmailLabels[k] ?? [], positive: rec.get(k) === true || rec.get(k) === "true", type: s(type.get(k)), stage: s(stage.get(k)), company: s(company.get(k)), role: s(role.get(k)), opp: s(opp.get(k)) });
    }
  }
  return { messages, rows };
}

export const pct = (k: number, n: number) => (n === 0 ? "n/a" : `${((100 * k) / n).toFixed(1)}%`);
export const category = (m: Msg) => m.labels.includes("CATEGORY_UPDATES") || m.labels.includes("CATEGORY_PERSONAL") || (m.labels.includes("INBOX") && !m.labels.some((l) => /CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)/.test(l)));
