import { isProgramName } from "./taxonomy.ts";
import type { ReaderType, VerifiedOutput } from "./types.ts";

/** One reader's view of a message, in the reader taxonomy. */
export type Reading = { recruiting: boolean; type: ReaderType | null; company: string | null; role: string | null };

export type Reconciled = {
  /** "review" is abstention: the readers disagree, or the model could not give a verified, non-guessing answer. */
  state: "recruiting" | "not_recruiting" | "review";
  reason: "agree" | "disagree" | "model_abstained";
  /** For review items: what the model would have said (never applied automatically). */
  modelSuggests: "recruiting" | "not_recruiting" | null;
  type: ReaderType | null;
  typeReview: boolean;
  company: string | null;
  companyReview: boolean;
  role: string | null;
  roleReview: boolean;
};

const STRIP = /\b(inc|llc|corp|corporation|ltd|co|company|the|group|international|foundation|team|recruiting|careers)\b/g;
const key = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(STRIP, "").replace(/[^a-z0-9]/g, "");
/** Lenient organization match: equal after dropping legal/generic words, or one contains the other. */
export function sameOrg(a: string | null | undefined, b: string | null | undefined) {
  const x = key(a ?? ""), y = key(b ?? "");
  return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x));
}

const abstains = (m: VerifiedOutput) => m.status !== "ok" || m.certainty === "low";

/**
 * Two readers, one verifier. `model` is null when the gate never sent the message to the model (treated as "not recruiting").
 * Disagreement is surfaced as review, never silently resolved; fields are reconciled only when both readers say recruiting.
 */
export function reconcile(rules: Reading, model: VerifiedOutput | null): Reconciled {
  const empty = { type: null, typeReview: false, company: null, companyReview: false, role: null, roleReview: false };
  const modelYes = model ? model.recruiting : false;
  if (model && abstains(model)) {
    return { state: "review", reason: "model_abstained", modelSuggests: null, ...empty, type: rules.type, company: rules.company, role: rules.role };
  }
  if (rules.recruiting !== modelYes) {
    return { state: "review", reason: "disagree", modelSuggests: modelYes ? "recruiting" : "not_recruiting", ...empty, type: model?.type ?? rules.type, company: rules.company ?? model?.company ?? null, role: model?.role ?? rules.role };
  }
  if (!rules.recruiting) return { state: "not_recruiting", reason: "agree", modelSuggests: null, ...empty };

  const m = model!;
  const typeReview = !!rules.type && !!m.type && rules.type !== m.type;
  const type = typeReview ? (m.certainty === "high" ? m.type : rules.type) : (m.type ?? rules.type);

  let company = rules.company, companyReview = false;
  if (rules.company && m.company) {
    if (sameOrg(rules.company, m.company)) company = m.company.length > rules.company.length ? m.company : rules.company; // fuller explicit name
    else companyReview = true;
  } else if (!rules.company && m.company) { company = m.company; companyReview = m.companySource === "quote"; }

  const ruleRole = rules.role && !isProgramName(rules.role) ? rules.role : null;
  const role = m.role ?? ruleRole;
  const roleReview = !!m.role && !!ruleRole && !sameOrg(m.role, ruleRole);
  return { state: "recruiting", reason: "agree", modelSuggests: null, type, typeReview, company, companyReview, role, roleReview };
}
