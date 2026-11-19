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
