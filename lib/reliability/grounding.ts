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
const FUNCTION_WORDS = new Set(["careers", "career", "karriere", "carrières", "carrieres", "carreras", "carreira", "carriere", "recruiting", "recruitment", "recruiter", "recruiters", "recrutement", "recruiting", "talent", "talente", "talento", "talentos", "talents", "jobs", "job", "hr", "rh", "rrhh", "people", "team", "equipo", "equipe", "hiring", "staffing", "applications", "application", "candidate", "candidates", "candidatures", "bewerbung", "bewerbungen", "personal", "personnel", "human", "resources", "admissions", "university", "internships", "internship", "campus", "early", "emploi", "empleo", "stellen", "no", "reply", "noreply", "notifications", "portal", "the", "via", "at", "from", "interview", "interviews", "interviewing", "assessment", "assessments", "scheduling", "schedule", "scheduler", "onboarding", "offer", "offers", "recruit", "update", "updates", "support", "help", "info", "admin", "system", "service", "services", "welcome", "news", "newsletter", "events", "event", "office", "center", "centre", "department", "student", "students", "graduate", "graduates", "grad", "applicant", "applicants", "hub", "desk", "mail", "email", "alerts", "alert", "community", "programs", "program", "success", "operations"]);
export function senderBrand(email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">): string | null {
  const display = email.from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  const words = display.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !FUNCTION_WORDS.has(w.toLowerCase().replace(/[^\p{L}]/gu, "")));
  if (kept.length === 0 || kept.length === words.length || kept.length > 4) return null;
  const brand = kept.join(" ");
  const domain = /@([^>\s]+)/.exec(email.from)?.[1]?.toLowerCase() ?? "";
  const b = squash(brand);
  if (b.length < 3) return null;
  const labels = domain.split(".").slice(0, -1).map(squash);
  const viaDomain = labels.some((l) => l.length >= 3 && (l.startsWith(b) || b.startsWith(l)));
  const inText = squash(`${email.subject} ${email.bodyText}`).includes(b);
  return viaDomain || inText ? brand : null;
}
