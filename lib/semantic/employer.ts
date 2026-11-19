import { sameOrg } from "../recruiting/reader/reconcile.ts";
import type { ExtractedEvent } from "../recruiting/types.ts";
import type { VerifiedReading } from "./reading.ts";

/** A semantic hypothesis about the employer is shown as "likely, needs confirmation" (below the product's "known" threshold of 0.6), never as fact. */
export const SEMANTIC_COMPANY_CONFIDENCE = 0.5;
export const KNOWN_BY_AGREEMENT = 0.6;

export const REASON_FROM_READER = "The company comes from reading the message, not from the sender: please confirm it.";
export const REASON_NOT_EMPLOYER = "The sender looks like a recruiting agency or platform, not the employer. Check the company.";
export const REASON_READERS_DISAGREE = "Two readers disagree about the company. Check which is right.";

/**
 * Reconciliation of the deterministic reading with the semantic reading, field by field. Disagreement is never settled by picking a winner on
 * the model's say-so:
 *   rules found no company, reader proposes a verified employer      -> adopted as LIKELY (0.5) and sent for confirmation
 *   both name the same company                                       -> kept; with some evidence already (>= 0.4) it becomes KNOWN (0.6)
 *   they differ and the rules were weak (< 0.5, e.g. from a generic sender domain) -> the verified employer replaces it as LIKELY, flagged
 *   they differ and the rules were confident                         -> the rules stand; the disagreement is flagged for a person
 *   the rules' company is an organization the reader typed as agency, platform or recruiter (a sender is not an employer) -> it is dropped: replaced
 *   by the verified employer if there is one (likely), otherwise unknown, and flagged
 *   rules found no role, reader quotes a verified role               -> adopted (the quote is in the message and passed role cleaning)
 * A reader with no verified employer changes nothing. Corrections and confirmations by the person are applied later and always win.
 */
const TITLE_NOUN = /\b(?:intern(?:ship)?|engineer|developer|analyst|assistant|associate|scientist|researcher|research|fellow(?:ship)?|scholar(?:ship)?|trainee|coordinator|designer|manager|co-?op|apprentice(?:ship)?|technician|consultant|officer|specialist|programmer|architect|teacher|tutor|nurse|resident(?:cy)?|stagiaire|praktikant\w*|pasant\w*|estagi\w*)\b/i;
/**
 * A role quoted from prose is often a description ("undergrad to help with the calibration project"), and two different descriptions of one job must not split one
 * lifecycle in two. A model-quoted role is adopted only when it reads like a job title: short, no clause, and a recognisable title noun.
 */
export function looksLikeTitle(role: string): boolean {
  const r = role.trim();
  const words = r.split(/\s+/);
  return words.length <= 8 && r.length <= 80 && !/\b(?:to|who|that|which|will|help|for the)\b/i.test(r.replace(/\b(?:Intern|Internship) to\b/i, "")) && TITLE_NOUN.test(r);
}

export function reconcileReadings(events: ExtractedEvent[], readings: Map<string, VerifiedReading>): ExtractedEvent[] {
  if (readings.size === 0) return events;
  return events.map((e) => {
    const r = readings.get(e.gmailMessageId);
    if (!r || e.outbound || r.output.status !== "ok" || r.output.certainty === "low") return e;
    let out = e;
    const fc = e.fieldConfidence ?? { type: e.confidence, company: e.confidence, role: e.confidence };
    const NOT_EMPLOYER_KINDS = ["recruiting_agency", "ats_vendor", "assessment_vendor", "job_board", "scheduler", "recruiter"];
    if (out.company && r.entities.some((x) => NOT_EMPLOYER_KINDS.includes(x.kind) && sameOrg(x.name, out.company))) {
      out = { ...out, company: null, fieldConfidence: { ...fc, company: 0.3 }, signals: [...out.signals, "semantic:sender_not_employer"], reviewReasons: [...new Set([...(out.reviewReasons ?? []), REASON_NOT_EMPLOYER])] };
    }
    if (r.employer) {
      const rules = out.company;
      const sem = r.employer.name;
      if (!rules) {
        out = { ...out, company: sem, fieldConfidence: { ...fc, company: SEMANTIC_COMPANY_CONFIDENCE }, signals: [...out.signals, "semantic:employer"], reviewReasons: [...new Set([...(out.reviewReasons ?? []), REASON_FROM_READER])] };
      } else if (sameOrg(rules, sem)) {
        const up = fc.company >= 0.4 && fc.company < KNOWN_BY_AGREEMENT;
        out = { ...out, fieldConfidence: up ? { ...fc, company: KNOWN_BY_AGREEMENT } : e.fieldConfidence, signals: [...out.signals, "semantic:employer_agrees"] };
      } else if ((out.fieldConfidence?.company ?? fc.company) < SEMANTIC_COMPANY_CONFIDENCE) {
        out = { ...out, company: sem, fieldConfidence: { ...fc, company: SEMANTIC_COMPANY_CONFIDENCE }, signals: [...out.signals, "semantic:employer_replaced"], reviewReasons: [...new Set([...(out.reviewReasons ?? []), REASON_READERS_DISAGREE])] };
      } else {
        out = { ...out, signals: [...out.signals, "semantic:employer_conflict"], reviewReasons: [...new Set([...(out.reviewReasons ?? []), REASON_READERS_DISAGREE])] };
      }
    }
    // An event the rules never produced (recognised only by the reader) carries a placeholder type; the reader's verified type is better, still low-confidence.
    if (out.signals.includes("semantic:yes") && out.type === "status_update" && r.output.type && r.output.type !== "status_update") {
      out = { ...out, type: r.output.type, fieldConfidence: { ...(out.fieldConfidence ?? fc), type: 0.4 }, signals: [...out.signals, "semantic:type"] };
    }
    if (!out.role && r.output.role && looksLikeTitle(r.output.role)) out = { ...out, role: r.output.role, signals: [...out.signals, "semantic:role"] };
    return out;
  });
}
