import { createHash } from "node:crypto";
import { labelViewRole, labelViewType } from "../reader/taxonomy.ts";
import type { AnalysisRow } from "./analysis.ts";
import type { Stratum } from "./labelset.ts";
import type { ShadowRecord } from "./shadow.ts";

/**
 * Pure glue between a stored human label, a shadow row and an analysis row. Used by the real analysis command and by the
 * synthetic workflow, so both exercise the same code.
 */
/** Opaque, stable mailbox label for results: a result file must never carry the account identifier. */
export const mailboxLabel = (userGoogleSub: string) => createHash("md5").update(userGoogleSub).digest("hex").slice(0, 8);

const NA = "not_applicable";
const UNKNOWN = "unknown";

/** Null when the labeler gave no recruiting decision (the message is not yet labeled). */
export function labelFactsFrom(l: Record<string, unknown> | undefined): AnalysisRow["label"] | null {
  if (!l || typeof l.is_recruiting !== "boolean") return null;
  const positive = l.is_recruiting;
  const known = (v: unknown) => (typeof v === "string" && v !== UNKNOWN && v !== NA ? v : null);
  const type = positive ? labelViewType(l.type, l.stage) : null;
  const role = positive ? labelViewRole(l.role) : UNKNOWN;
  return {
    positive,
    type: type && type !== UNKNOWN && type !== NA ? type : null,
    company: positive ? known(l.company) : null,
    role: role === UNKNOWN ? null : role,
    opportunity: positive ? known(l.opportunity_ref) : null,
  };
}

export function toAnalysisRow(rec: ShadowRecord, sel: { stratum: Stratum; weight: number }, label: AnalysisRow["label"]): AnalysisRow {
  return {
    mailbox: mailboxLabel(rec.userGoogleSub),
    messageId: rec.gmailMessageId,
    threadId: rec.gmailThreadId,
    stratum: sel.stratum,
    weight: sel.weight,
    label,
    v2: {
      state: rec.state,
      reviewReason: rec.reviewReason,
      modelSuggests: rec.modelSuggests,
      finalType: rec.finalType,
      finalCompany: rec.finalCompany,
      finalRole: rec.finalRole,
      isCandidate: rec.isCandidate,
      plannedRead: rec.plannedRead,
      modelRead: rec.modelStatus !== null,
      ungrounded: rec.modelUngrounded,
    },
    legacyFound: rec.legacyQueryMatch === true && rec.rulesRecruiting,
  };
}
