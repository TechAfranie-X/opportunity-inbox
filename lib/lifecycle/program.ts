import type { EffectiveEvent } from "../recruiting/types.ts";

/**
 * A programme (fellowship, academy, bootcamp, mentorship, scholarship) has its own lifecycle, which is NOT the job pipeline's: invited -> accepted -> enrolled -> participating -> completed,
 * or ended by a rejection / the person's withdrawal. Its evidence (an acceptance, a cohort calendar, a section reminder, a completion notice) is read as `program:<stage>` facts and programme
 * evidence; this folds them into one state so a programme is never shown as a job "Applied" or "Interview". Pure: facts in, state out.
 */
export type ProgramState = "applied" | "invited" | "accepted" | "enrolled" | "participating" | "completed" | "awarded" | "removed" | "rejected" | "withdrawn";
export const PROGRAM_STATE_LABEL: Record<ProgramState, string> = {
  applied: "Applied", invited: "Invited", accepted: "Accepted", enrolled: "Enrolled", participating: "In progress", completed: "Completed", awarded: "Awarded", removed: "Removed", rejected: "Not selected", withdrawn: "Withdrawn",
};
const ORDER: ProgramState[] = ["applied", "invited", "accepted", "enrolled", "participating", "completed", "awarded"];
const FACT: Record<string, ProgramState> = { "program:removed": "removed", "program:awarded": "awarded", "program:invited": "invited", "program:accepted": "accepted", "program:enrolled": "enrolled", "program:completed": "completed" };

export function programLifecycle(events: EffectiveEvent[]): { state: ProgramState; at: Date | null } {
  const cur: { state: ProgramState; at: Date | null } = { state: "applied", at: null };
  const bump = (s: ProgramState, e: EffectiveEvent) => { if (ORDER.indexOf(s) >= ORDER.indexOf(cur.state)) { cur.state = s; cur.at = e.occurredAt; } };
  const inbound = events.filter((e) => !e.outbound);
  const end = [...events].reverse().find((e) => (!e.outbound && (e.type === "rejection" || e.type === "withdrawn")) || (e.outbound && e.type === "withdrawn"));
  // a stage fact that comes AFTER an ending reopens it (a rejection that was reversed); anything before it is history
  for (const e of inbound) for (const x of e.signals) { const s = FACT[x]; if (s) bump(s, e); }
  // the programme removed the person: that is final unless a LATER acceptance/enrolment says otherwise
  const removedAt = [...inbound].reverse().find((e) => e.signals.includes("program:removed"));
  if (removedAt && !inbound.some((e) => e.occurredAt.getTime() > removedAt.occurredAt.getTime() && e.signals.some((x) => x === "program:accepted" || x === "program:enrolled"))) return { state: "removed", at: removedAt.occurredAt };
  const reopened = !!end && !!cur.at && cur.at.getTime() > end.occurredAt.getTime();
  if (end && !reopened) return { state: end.type === "rejection" ? "rejected" : "withdrawn", at: end.occurredAt };
  // living in the programme: its own sessions, calendar, onboarding or progress mail after the person was accepted or enrolled
  if ((cur.state === "accepted" || cur.state === "enrolled") && cur.at) {
    const first = inbound.find((e) => e.signals.some((x) => x === "program:accepted" || x === "program:enrolled"));
    const since = (first ?? { occurredAt: cur.at }).occurredAt.getTime();
    const live = [...inbound].reverse().find((e) => e.occurredAt.getTime() > since && !e.signals.includes("class:marketing") && !e.signals.includes("class:notice") && (e.signals.some((x) => x.startsWith("program:evidence:")) || e.type !== "applied"));
    if (live) bump("participating", live);
  }
  return { state: cur.state, at: cur.at };
}
