import { looksLikePerson } from "../recruiting/company.ts";
import { classifySender, isIntermediaryBrand } from "../recruiting/entity/vendors.ts";
import { sameOrg } from "../recruiting/reader/reconcile.ts";
import { norm, verifyOutput } from "../recruiting/reader/verify.ts";
import type { RawReaderOutput, ReaderInput, VerifiedOutput } from "../recruiting/reader/types.ts";
import { VENDOR_KEYS } from "../identity/resolve.ts";

/** Vendors that must never be the employer. A few names double as real companies (Oracle, Rippling, Gem, Dover); those are judged by evidence, not blocked. */
const NOT_EMPLOYER = new Set([...VENDOR_KEYS].filter((k) => !["oracle", "rippling", "gem", "dover"].includes(k)));

/**
 * Semantic reading v2: not "is this recruiting", but who is who. The reader names the organizations and people in a message, says what kind of
 * thing each is, and states which one the person applied to or is being hired by, quoting the words that show the relationship. Everything it says
 * is a proposal. `verifyReading` is the only way a proposal becomes something the product may use.
 */
export const ENTITY_KINDS = ["employer", "recruiting_agency", "recruiter", "ats_vendor", "assessment_vendor", "job_board", "scheduler", "other"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** How the message shows that an organization is the employer. A name appearing near other words is not a relationship. */
export const EMPLOYER_BASES = ["applied_to", "interview_with", "assessment_for", "offer_from", "rejection_from", "hiring_for", "represents", "sender_is_employer"] as const;
export type EmployerBasis = (typeof EMPLOYER_BASES)[number];

export type RawReading = {
  key: string;
  recruiting: "yes" | "no";
  event: { type: string | null; stage: string | null; quote: string | null } | null;
  entities: Array<{ name: string; kind: string; quote: string }>;
  employer: { name: string; basis: string; quote: string } | null;
  role: { quote: string } | null;
  deadline: { quote: string } | null;
  certainty: string;
};

export type VerifiedEntity = { name: string; kind: EntityKind };
export type VerifiedReading = {
  key: string;
  /** The same fields the first semantic milestone used (recruiting, type, stage, role, date, evidence), so consensus is unchanged. */
  output: VerifiedOutput;
  entities: VerifiedEntity[];
  /** Present only when the message itself shows the employer and the name is not a vendor, an agency, a person or the transport. */
  employer: { name: string; basis: EmployerBasis } | null;
  /** Why anything was dropped. Never contains message text. */
  rejections: string[];
};

const AGENCY_WORDS = /\b(staffing|recruiting agency|search firm|talent solutions|recruitment|robert half|adecco|randstad|kforce|insight global|tek ?systems|aerotek)\b/i;
const SENDER_NOISE = /\b(recruiting|recruitment|recruiter|careers|career|talent|hiring|team|university|campus|early career|jobs|no-?reply|notifications?)\b/gi;
const senderDomain = (from: string) => from.match(/@([\w.-]+)\s*$/)?.[1]?.toLowerCase() ?? "";
const senderBrand = (from: string) => from.replace(/@[\w.-]+\s*$/, "").replace(SENDER_NOISE, " ").replace(/\s+/g, " ").trim();
const domainLabel = (d: string) => d.split(".").slice(-2, -1)[0] ?? "";

const asKind = (k: unknown): EntityKind => ((ENTITY_KINDS as readonly string[]).includes(String(k)) ? (k as EntityKind) : "other");

/** Deterministic gatekeeper for the relationship layer. A proposal that cannot be traced to the message, or that confuses the channel with the employer, becomes an abstention. */
export function verifyReading(raw: unknown, input: ReaderInput): VerifiedReading {
  const rej: string[] = [];
  const empty = (output: VerifiedOutput): VerifiedReading => ({ key: input.key, output, entities: [], employer: null, rejections: [...rej, ...output.rejections] });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty(verifyOutput(null, input));
  const r = raw as Partial<RawReading>;

  // The shared fields go through the first milestone's verifier unchanged (evidence, type, stage, role cleaning, date parsing).
  const shared: RawReaderOutput = {
    key: String(r.key ?? ""),
    recruiting: r.recruiting === "yes" ? "yes" : "no",
    type: r.event?.type ?? null,
    stage: r.event?.stage ?? null,
    company_candidate: null,
    company_quote: null,
    role_quote: r.role?.quote ?? null,
    date_quote: r.deadline?.quote ?? null,
    evidence_quote: r.event?.quote ?? r.employer?.quote ?? null,
    certainty: String(r.certainty ?? ""),
  };
  if (r.recruiting !== "yes" && r.recruiting !== "no") shared.recruiting = "no";
  const output = verifyOutput({ ...shared, recruiting: r.recruiting === "yes" ? "yes" : r.recruiting === "no" ? "no" : "x" }, input);
  if (output.status !== "ok") return empty(output);

  const hay = norm(`${input.from}\n${input.subject}\n${input.body}`);
  const inText = (s: unknown) => typeof s === "string" && s.trim().length >= 2 && hay.includes(norm(s));

  // Entities: each must be quoted from the message. Their kinds are used only to rule things out.
  const entities: VerifiedEntity[] = [];
  for (const e of Array.isArray(r.entities) ? r.entities.slice(0, 12) : []) {
    if (!e || typeof e.name !== "string") continue;
    if (!inText(e.name)) { rej.push("entity:name_not_in_text"); continue; }
    entities.push({ name: e.name.trim(), kind: asKind(e.kind) });
  }
  const kindOf = (name: string): EntityKind | null => entities.find((e) => sameOrg(e.name, name))?.kind ?? null;

  let employer: VerifiedReading["employer"] = null;
  if (output.recruiting && r.employer && typeof r.employer.name === "string") {
    const name = r.employer.name.trim();
    const quote = r.employer.quote;
    const basis = r.employer.basis as EmployerBasis;
    const fromCandidate = input.candidates.some((c) => sameOrg(c.name, name));
    const bad = (why: string) => { rej.push(`employer:${why}`); };
    if (!(EMPLOYER_BASES as readonly string[]).includes(String(basis))) bad("basis_invalid");
    else if (!inText(name) && !fromCandidate) bad("name_not_in_text");
    else if (!inText(quote) || norm(String(quote)).split(" ").length < 3) bad("relationship_quote_missing");
    else if (!norm(String(quote)).includes(norm(name))) bad("quote_does_not_name_employer");
    else if (name.split(/\s+/).length > 6 || !/^[A-Z0-9]/.test(name) || /^(?:the|our|your|team|company|hiring team|recruiting|careers|university|program)$/i.test(name)) bad("implausible");
    else if (isIntermediaryBrand(name) || NOT_EMPLOYER.has(name.toLowerCase().replace(/[^a-z0-9]/g, ""))) bad("vendor_not_employer");
    else if (looksLikePerson(name)) bad("person_not_employer");
    else if (["ats_vendor", "assessment_vendor", "job_board", "scheduler", "recruiter", "recruiting_agency"].includes(kindOf(name) ?? "employer")) bad(`entity_is_${kindOf(name)}`);
    else if (AGENCY_WORDS.test(name) && basis !== "represents") bad("agency_not_employer");
    else if (basis === "sender_is_employer") {
      // "The sender is the employer" is accepted only when the sending domain is the employer's own and carries the same name.
      const dom = senderDomain(input.from);
      if (classifySender(dom) !== "employer" || !(sameOrg(domainLabel(dom), name) || sameOrg(senderBrand(input.from), name))) bad("sender_not_employer");
      else employer = { name, basis };
    } else employer = { name, basis };
  } else if (output.recruiting && r.employer) rej.push("employer:schema");

  // The reader's single company field never leaks past this point: only the verified employer is carried.
  output.company = employer?.name ?? null;
  output.companySource = employer ? "quote" : null;
  return { key: input.key, output, entities, employer, rejections: [...rej, ...output.rejections] };
}
