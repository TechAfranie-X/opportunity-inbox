import { cleanRole, looksLikePerson } from "../company.ts";
import { findDateMentions } from "../dates.ts";
import { isIntermediaryBrand } from "../entity/vendors.ts";
import { STAGES, type Stage } from "../types.ts";
import { sha } from "./guide.ts";
import { isProgramName } from "./taxonomy.ts";
import { CERTAINTIES, READER_TYPES, type Certainty, type RawReaderOutput, type ReaderInput, type ReaderType, type VerifiedOutput } from "./types.ts";

/** Comparison form used for "is this quote in the message": case, spacing, quotes and dashes do not matter; nothing else is forgiven. */
export const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const haystack = (input: ReaderInput) => norm(`${input.from}\n${input.subject}\n${input.body}`);
const wordCount = (s: string) => s.trim().split(/\s+/).length;
const GENERIC_COMPANY = /^(?:the|our|your|team|company|hiring team|recruiting|careers|university|program|candidate|applicant|student)$/i;

/** Deterministic gatekeeper between the model and everything downstream. A field that fails is dropped, never repaired. */
export function verifyOutput(raw: unknown, input: ReaderInput): VerifiedOutput {
  const base: VerifiedOutput = { key: input.key, status: "invalid", recruiting: false, type: null, stage: null, company: null, companySource: null, role: null, dateText: null, certainty: "low", evidence: null, rejections: [] };
  const rej = base.rejections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { rej.push("schema:not_object"); return base; }
  const o = raw as Partial<RawReaderOutput>;
  if (o.key !== input.key) { rej.push("schema:key_mismatch"); return base; }
  if (o.recruiting !== "yes" && o.recruiting !== "no") { rej.push("schema:recruiting"); return base; }
  if (!(CERTAINTIES as readonly string[]).includes(String(o.certainty))) { rej.push("schema:certainty"); return base; }
  base.certainty = o.certainty as Certainty;
  base.recruiting = o.recruiting === "yes";
  const hay = haystack(input);
  const inText = (q: unknown, max: number): q is string => typeof q === "string" && q.trim().length >= 2 && q.length <= max && hay.includes(norm(q));

  // Evidence: every "yes" must be justified by a quote that exists in the message.
  if (typeof o.evidence_quote === "string" && o.evidence_quote.trim()) {
    const q = norm(o.evidence_quote);
    const at = hay.indexOf(q);
    if (at >= 0 && q.length >= 4) base.evidence = { hash: sha(q).slice(0, 16), offset: at };
    else rej.push("evidence:not_in_text");
  }
  if (!base.recruiting) { base.status = "ok"; return base; }
  if (!base.evidence) { base.status = "unsupported_yes"; return base; }
  base.status = "ok";

  if (typeof o.type === "string" && (READER_TYPES as readonly string[]).includes(o.type)) base.type = o.type as ReaderType;
  else rej.push(o.type == null ? "type:missing" : "type:invalid_enum");
  if (typeof o.stage === "string" && (STAGES as string[]).includes(o.stage)) base.stage = o.stage as Stage;
  else rej.push(o.stage == null ? "stage:missing" : "stage:invalid_enum");

  // Company: a candidate id from the list, or an exact quote that is plausibly an organization and not a vendor or a person.
  if (o.company_candidate != null) {
    const c = input.candidates.find((x) => x.id === o.company_candidate);
    if (c) { base.company = c.name; base.companySource = "candidate"; } else rej.push("company:unknown_candidate");
  }
  if (!base.company && o.company_quote != null && o.company_quote !== "") {
    const q = String(o.company_quote);
    if (!inText(q, 80)) rej.push("company:quote_not_in_text");
    else if (wordCount(q) > 6 || !/^[A-Z0-9]/.test(q.trim()) || GENERIC_COMPANY.test(q.trim())) rej.push("company:implausible");
    else if (isIntermediaryBrand(q) || looksLikePerson(q.trim())) rej.push("company:vendor_or_person");
    else { base.company = q.trim(); base.companySource = "quote"; }
  }
  if (base.company && isIntermediaryBrand(base.company)) { rej.push("company:vendor_or_person"); base.company = null; base.companySource = null; }

  // Role: an exact quote that survives the same plausibility cleaning the rules use, and is not a program name (guide v2).
  if (o.role_quote != null && o.role_quote !== "") {
    const q = String(o.role_quote);
    if (!inText(q, 100) || wordCount(q) > 10) rej.push("role:quote_not_in_text");
    else if (/\[(?:link|email|num|candidate)\]/.test(q)) rej.push("role:redaction_token");
    else if (isProgramName(q)) rej.push("role:program_name");
    else {
      const cleaned = cleanRole(q, base.company);
      if (!cleaned || !hay.includes(norm(cleaned))) rej.push("role:implausible");
      else base.role = cleaned;
    }
  }

  // Date: the quote must be in the message and must parse as a date mention.
  if (o.date_quote != null && o.date_quote !== "") {
    const q = String(o.date_quote);
    if (!inText(q, 80)) rej.push("date:quote_not_in_text");
    else if (findDateMentions(q, new Date(input.received)).length === 0) rej.push("date:unparseable");
    else base.dateText = q.trim();
  }
  return base;
}

/** Independent re-check used by the evaluation: counts any stored structured value that is not traceable to the input. */
export function auditGrounding(out: VerifiedOutput, input: ReaderInput): string[] {
  const hay = haystack(input);
  const bad: string[] = [];
  if (out.company) {
    const fromCandidate = input.candidates.some((c) => c.name === out.company);
    if (!fromCandidate && !hay.includes(norm(out.company))) bad.push("company");
  }
  if (out.role && !hay.includes(norm(out.role))) bad.push("role");
  if (out.dateText && !hay.includes(norm(out.dateText))) bad.push("date");
  if (out.evidence && hay.slice(out.evidence.offset, out.evidence.offset + 4).length < 4) bad.push("evidence");
  if (out.type && !(READER_TYPES as readonly string[]).includes(out.type)) bad.push("type");
  return bad;
}
