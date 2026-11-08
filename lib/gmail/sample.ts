import type { RecruitingEmail } from "../recruiting/types.ts";

/**
 * Sample mailbox: a local, synthetic mailbox so the whole signed-in product can be used and tested without Gmail. It exists only
 * in development: the sign-in path is enabled by SAMPLE_LOGIN=1 and is ALWAYS off when NODE_ENV is "production". Sample users are
 * identified by their id prefix, which no real Google account id can have (those are numeric).
 */
export const SAMPLE_PREFIX = "sample-";
export const SAMPLE_SUB = `${SAMPLE_PREFIX}sam-rivera`;
export const SAMPLE_EMAIL = "sam.rivera@sample.invalid";
export const SAMPLE_NAME = "Sam Rivera";

export const isSampleUser = (sub: string | null | undefined): boolean => typeof sub === "string" && sub.startsWith(SAMPLE_PREFIX);

export function isSampleLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SAMPLE_LOGIN === "1" && env.NODE_ENV !== "production";
}

/**
 * Emulates the Gmail search the product really uses (the subject keywords and the applicant-tracking senders), by reading the
 * actual query string, so the sample mailbox can never silently disagree with it. Operators such as newer_than and -in: are
 * ignored: the sample mailbox contains only inbox mail from the last year.
 */
export function queryMatcher(query: string): (email: Pick<RecruitingEmail, "from" | "subject">) => boolean {
  const group = (key: string) => {
    const m = query.match(new RegExp(`${key}:\\(([^)]*)\\)`));
    return m ? [...m[1].matchAll(/"([^"]+)"|([^\s]+)/g)].map((x) => (x[1] ?? x[2]).trim()).filter((t) => t && t !== "OR") : [];
  };
  const subjects = group("subject").map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i"));
  const senders = group("from").map((t) => t.toLowerCase());
  return (e) => subjects.some((re) => re.test(e.subject)) || senders.some((d) => e.from.toLowerCase().includes(d));
}
