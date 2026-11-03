import type { EventType } from "../types.ts";
import type { ReaderType } from "./types.ts";

/** Legacy type -> reader taxonomy. follow_up and assessment_completed carry no extra product behavior beyond status + stage. */
export function toReaderType(type: EventType | null): ReaderType | null {
  if (!type) return null;
  switch (type) {
    case "follow_up":
    case "assessment_completed":
    case "user_reply":
      return "status_update";
    default:
      return type;
  }
}

const PROGRAM = /(program|programme|fellowship|fellows|institute|academy|scholar|cohort|apprentice|bootcamp|leadership|training|summit|forum|initiative)/i;
const POSITION = /(intern|engineer|analyst|developer|scientist|manager|associate|designer|researcher|assistant|architect|specialist|technician|consultant|coordinator|representative|trainee|co-?op)/i;

/** Guide v2: a program or fellowship name is not a job role. */
export function isProgramName(role: string) {
  return PROGRAM.test(role) && !POSITION.test(role);
}

/**
 * Read-only view of a stored label under guide v2. The stored label is never modified; this is only how it is read when a
 * v2 decision mechanically changes its meaning (taxonomy collapse, program names are not roles, confirmation + assessment).
 */
export function labelViewType(type: unknown, stage: unknown): ReaderType | "unknown" | "not_applicable" | null {
  if (type === "unknown" || type === "not_applicable") return type;
  if (typeof type !== "string") return null;
  if (type === "applied" && stage === "assessment") return "assessment";
  return toReaderType(type as EventType);
}

export function labelViewRole(role: unknown): string {
  const r = String(role ?? "");
  if (r === "unknown" || r === "not_applicable") return r;
  return isProgramName(r) ? "not_applicable" : r;
}
