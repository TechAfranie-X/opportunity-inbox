import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";

/**
 * Deterministic grounding: every structured value we show (company, role) should be traceable to words in the message it came
 * from, or to the message it was linked to. This does not decide anything; it checks that what the reader says it saw is there.
 * A value that fails is dropped to "unknown" and sent to review instead of being shown as fact.
 */
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const squash = (s: string) => norm(s).replace(/ /g, "");

/** Events whose company/role were carried over from another message on purpose (thread, contact, inherited role). They are traced to that message, not this text. */
const LINKED = new Set(["reply-in-recruiting-thread", "known-contact-continuity"]);
export const isLinkedEvent = (e: Pick<ExtractedEvent, "signals">) => e.signals.some((s) => LINKED.has(s));

export function companyGrounded(email: Pick<RecruitingEmail, "from" | "replyTo" | "subject" | "bodyText">, company: string): boolean {
  const c = norm(company);
  if (!c) return true;
  const text = norm(`${email.from} ${email.replyTo ?? ""} ${email.subject} ${email.bodyText}`);
  if (` ${text} `.includes(` ${c} `)) return true;
  // sender and domain tokens run words together ("capitalone.com"), and a name may be split by punctuation
  const addresses = squash(`${email.from} ${email.replyTo ?? ""}`);
  return addresses.includes(squash(company)) || squash(`${email.subject} ${email.bodyText}`).includes(squash(company));
}

/** The name is written in the subject or body (not only in the sender's name or address). */
export function companyInText(email: Pick<RecruitingEmail, "subject" | "bodyText">, company: string): boolean {
  const c = norm(company);
  if (!c) return true;
  return ` ${norm(`${email.subject} ${email.bodyText}`)} `.includes(` ${c} `) || squash(`${email.subject} ${email.bodyText}`).includes(squash(company));
}

/** The name is just the sender's own domain written as a name ("talentbogen.example" -> "Talentbogen"): it says who SENT the mail, whatever else the text says. */
export function nameOfSenderDomain(email: Pick<RecruitingEmail, "from">, company: string): boolean {
  const domain = /@([^>\s]+)/.exec(email.from)?.[1]?.toLowerCase();
  if (!domain) return false;
  const labels = domain.split(".").slice(0, -1);
  const c = squash(company);
  return c.length > 0 && (labels.some((l) => squash(l) === c) || squash(labels.slice(-1)[0] ?? "") === c);
}

export function roleGrounded(email: Pick<RecruitingEmail, "subject" | "bodyText">, role: string): boolean {
  const r = norm(role);
  if (!r) return true;
  return squash(`${email.subject} ${email.bodyText}`).includes(r.replace(/ /g, ""));
}

export type GroundingReport = { company: boolean; role: boolean };

/** What is and is not traceable. Linked events are exempt for the fields they inherit. */
export function groundingOf(email: RecruitingEmail, event: ExtractedEvent): GroundingReport {
  const linked = isLinkedEvent(event);
  return {
    company: linked || !event.company || companyGrounded(email, event.company),
    // an inherited role is traced to the message it came from (marked "role-inherited"), not to this one
    role: linked || event.signals.includes("role-inherited") || !event.role || roleGrounded(email, event.role),
  };
}

/**
 * The employer an organisation's own sender label names: "Kleinwerk Karriere", "Copperline Careers", "Harbor & Pine Recruiting". Employers keep their name in the
 * display name even when an applicant-tracking platform delivers the mail, so the label minus its generic function words ("careers", "talent", "recruiting"...)
 * is the employer, if at least one such word was removed (so a person's name is never a brand) and the rest is corroborated: it is written in the message, or it is
 * the start of one of the sender domain's own labels ("copperline-logistics.example"). Returns null otherwise.
 */
const FUNCTION_WORDS = new Set(["careers", "career", "karriere", "carrières", "carrieres", "carreras", "carreira", "carriere", "recruiting", "recruitment", "recruiter", "recruiters", "recrutement", "recruiting", "talent", "talente", "talento", "talentos", "talents", "jobs", "job", "hr", "rh", "rrhh", "people", "team", "equipo", "equipe", "hiring", "staffing", "applications", "application", "candidate", "candidates", "candidatures", "bewerbung", "bewerbungen", "personal", "personnel", "human", "resources", "admissions", "university", "internships", "internship", "campus", "early", "emploi", "empleo", "stellen", "no", "reply", "noreply", "notifications", "portal", "the", "via", "at", "from", "interview", "interviews", "interviewing", "assessment", "assessments", "scheduling", "schedule", "scheduler", "onboarding", "offer", "offers", "recruit", "update", "updates", "support", "help", "info", "admin", "system", "service", "services", "welcome", "news", "newsletter", "events", "event", "office", "center", "centre", "department", "student", "students", "graduate", "graduates", "grad", "applicant", "applicants", "hub", "desk", "mail", "email", "alerts", "alert", "community", "programs", "program", "success", "operations", "acquisition", "scholarship", "scholarships", "community", "admission", "recruitment", "sourcing", "experience", "relations", "outreach"]);
export function senderBrandInfo(email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">): { name: string; exact: boolean } | null {
  let display = email.from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  // "Dexi from Sodexo", "Ana at Orbis", "Marta de Solmar": the organisation is what follows the preposition, the person what precedes it
  const via = /\s(?:from|at|de|bei|chez|di|da)\s+(.+)$/i.exec(display);
  if (via) display = via[1];
  const words = display.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !FUNCTION_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu, "")));
  if (kept.length === 0 || (kept.length === words.length && !via) || kept.length > 4) return null;
  if (!kept.every((w) => /^[\p{L}\d][\p{L}\d&.'’-]*$/u.test(w))) return null; // punctuation-led fragments ("(Gen)", "- Team") are not names
  const domain = /@([^>\s]+)/.exec(email.from)?.[1]?.toLowerCase() ?? "";
  const inText = squash(`${email.subject} ${email.bodyText}`).includes(squash(kept.join(" ")));
  // corroborated by the sender's own domain: the brand is the LONGEST run of leading words every one of which is a label of the domain ("Intuit" for "Intuit Talent
  // Acquisition" at intuit.com; "Nordmarkt Logistik" for "Nordmarkt Logistik Karriere" at logistik.nordmarkt.example). Longest, so a division is never lost to its parent.
  const labelSet = new Set(domain.split(".").slice(0, -1).map(squash).filter((l) => l.length >= 3));
  for (let n = kept.length; n >= 1; n--) {
    const head = kept.slice(0, n);
    if (head.every((w) => squash(w).length >= 3 && [...labelSet].some((l) => l === squash(w) || (n === 1 && (l.startsWith(squash(w)) || squash(w).startsWith(l)))))) return { name: head.join(" "), exact: head.every((w) => labelSet.has(squash(w))) };
    const joined = squash(head.join(" "));
    if (joined.length >= 3 && [...labelSet].some((l) => l === joined || (n === kept.length && (l.startsWith(joined) || joined.startsWith(l))))) return { name: head.join(" "), exact: [...labelSet].some((l) => l === joined) };
  }
  return inText && squash(kept.join(" ")).length >= 3 ? { name: kept.join(" "), exact: true } : null;
}

/** The employer's own sender label, as a name. */
export function senderBrand(email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">): string | null {
  return senderBrandInfo(email)?.name ?? null;
}

/**
 * Where the employer name came from. A name written in the message is trusted as read; a name that exists only in the sender's name or address says who SENT the
 * mail (a platform, a mailbox provider), marked `employer:sender-only` so later stages weigh it as weak. The employer's own sender label ("Copperline Careers")
 * names the employer even when a platform delivers the mail or the reader fell back to the domain. Applied to every event a reader produces, rules or model.
 */
export function employerProvenance<T extends ExtractedEvent>(email: RecruitingEmail, event: T): T {
  const out = { ...event, signals: [...event.signals], reviewReasons: [...(event.reviewReasons ?? [])] };
  out.signals = out.signals.filter((x) => x !== "employer:sender-only");
  if (out.company && (!companyInText(email, out.company) || nameOfSenderDomain(email, out.company))) out.signals.push("employer:sender-only");
  if (!out.company || out.signals.includes("employer:sender-only")) {
    const info = senderBrandInfo(email);
    if (info) {
      const brand = info.name;
      // trusted as is when the message text writes it OR the sender's own domain spells exactly that name ("Ridgeway Careers" at ridgeway.example); a name that only STARTS the domain's
      // label ("Quill" for quill-labs.example) may be incomplete: likely, and the person is asked once
      const solid = companyInText(email, brand) || info.exact;
      out.company = brand;
      out.fieldConfidence = { type: out.fieldConfidence?.type ?? out.confidence, role: out.fieldConfidence?.role ?? out.confidence, company: Math.max(out.fieldConfidence?.company ?? 0, solid ? 0.5 : 0.38) };
      out.signals = [...out.signals.filter((x) => x !== "employer:sender-only"), "employer:display-name"];
      if (!solid) out.reviewReasons.push("company: taken from the sender's label, not from the message text");
    }
  }
  const unit = unitOf(email);
  if (unit && !out.signals.some((x) => x.startsWith("unit:"))) out.signals.push(`unit:${unit}`);
  return out;
}

/**
 * UNIT evidence: employers write to the person about the part of the organisation that is hiring ("The Clinical Informatics team will review it", "the Controls team", "Équipe
 * Logistique"). When one employer runs several applications at once and its receipts and updates name no role, the unit is often the only thing that tells them apart. It is
 * stored as the signal `unit:<name>` and used by identity as soft evidence; generic hiring words ("the hiring team", "Talent team") are never units.
 */
const UNIT_GENERIC = new Set(["hiring", "recruiting", "recruitment", "recruiter", "talent", "careers", "career", "hr", "human", "resources", "people", "university", "campus", "early", "student", "students", "our", "your", "the", "a", "this", "that", "support", "admissions", "application", "applications", "review", "interview", "selection", "candidate", "candidates", "team", "equipo", "equipe", "gente", "personal", "rh", "rrhh", "bewerbung", "bewerbungen", "ressources", "humaines"]);
const CAP = "[\\p{Lu}][\\p{L}&'’-]*";
const UNIT_AFTER = new RegExp(`\\b(${CAP}(?: (?:and |& |y |et |und |e )?${CAP}){0,3})(?: hiring| recruiting)? (?:team|group|department|division|unit|lab|practice)\\b`, "u");
const UNIT_BEFORE = new RegExp(`\\b(?:equipo|equipe|équipe|team|área|area|abteilung|bereich|squadra|reparto)(?: de| du| des| of| für| di| da| do)? (${CAP}(?: ${CAP}){0,2})`, "u");
export function unitOf(email: Pick<RecruitingEmail, "subject" | "bodyText">): string | null {
  const text = `${email.subject}\n${email.bodyText.slice(0, 1500)}`;
  for (const re of [UNIT_AFTER, UNIT_BEFORE]) {
    const m = re.exec(text);
    if (!m) continue;
    const toks = m[1].toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t && !["and", "y", "et", "und", "e"].includes(t));
    const useful = toks.filter((t) => !UNIT_GENERIC.has(t));
    if (useful.length === 0) continue;
    return useful.join(" ");
  }
  return null;
}
