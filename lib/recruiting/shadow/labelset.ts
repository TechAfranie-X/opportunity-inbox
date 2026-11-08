import { FROZEN } from "./frozen.ts";

/**
 * Which prospective messages get a human label. A function of INGESTION-TIME FACTS ONLY.
 *
 * This is the leakage barrier. The rows handed to this module carry exactly the fields below: when and where a message
 * arrived, which pipeline version saw it, whether it was a v2 candidate, whether the model was planned to read it, and its
 * hash-assigned sampling arm. Nothing a reader decided (rules, model, state, review, suggestion, final fields) is in the
 * type, the database query that feeds it selects only these columns, and a test hands it an object that throws if any
 * other property is touched. So labels cannot be selected, steered or skipped on the basis of what the system said.
 *
 *   S1: every eligible v2 candidate planned for a model read (a census, weight 1).
 *   S2: every other eligible message that is in the sampling arm (a 25% sample, weight 1 / 0.25 = 4).
 */
export const INGESTION_COLUMNS = [
  "userGoogleSub", "gmailMessageId", "gmailThreadId", "arrivedAt", "readerVersion", "pipelineVersion", "extractorVersion",
  "cohort", "uniformArm", "isCandidate", "plannedRead",
] as const;

export type IngestionFacts = {
  userGoogleSub: string;
  gmailMessageId: string;
  gmailThreadId: string;
  arrivedAt: Date;
  readerVersion: string;
  pipelineVersion: string;
  extractorVersion: string;
  cohort: string;
  uniformArm: boolean;
  isCandidate: boolean;
  plannedRead: boolean;
};

export type Stratum = "S1" | "S2";
export type ExcludedReason = "frozen_version_mismatch" | "before_cutoff" | "after_window" | "cohort_inconsistent" | "not_in_label_set";
export type Classification = { eligible: true; stratum: Stratum; weight: number } | { eligible: false; reason: ExcludedReason };

const CUTOFF = new Date(FROZEN.cutoff).getTime();
const THROUGH = new Date(FROZEN.eligibleThrough).getTime();

export function classify(f: IngestionFacts): Classification {
  if (f.readerVersion !== FROZEN.readerVersion || f.pipelineVersion !== FROZEN.pipelineVersion || f.extractorVersion !== FROZEN.extractorVersion) {
    return { eligible: false, reason: "frozen_version_mismatch" };
  }
  const t = f.arrivedAt.getTime();
  if (t < CUTOFF) return { eligible: false, reason: "before_cutoff" };
  if (t >= THROUGH) return { eligible: false, reason: "after_window" };
  if (f.cohort !== "prospective") return { eligible: false, reason: "cohort_inconsistent" };
  if (f.isCandidate && f.plannedRead) return { eligible: true, stratum: "S1", weight: 1 };
  if (f.uniformArm) return { eligible: true, stratum: "S2", weight: FROZEN.s2Weight };
  return { eligible: false, reason: "not_in_label_set" };
}

export type Selected = { userGoogleSub: string; gmailMessageId: string; gmailThreadId: string; arrivedAt: Date; stratum: Stratum; weight: number };

export function selectLabelSet(rows: IngestionFacts[]): Selected[] {
  const out: Selected[] = [];
  for (const f of rows) {
    const c = classify(f);
    if (c.eligible) out.push({ userGoogleSub: f.userGoogleSub, gmailMessageId: f.gmailMessageId, gmailThreadId: f.gmailThreadId, arrivedAt: f.arrivedAt, stratum: c.stratum, weight: c.weight });
  }
  return out;
}

/** ISO year and week of a date (UTC), e.g. "2026w49", used to name weekly label datasets. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}w${String(week).padStart(2, "0")}`;
}
