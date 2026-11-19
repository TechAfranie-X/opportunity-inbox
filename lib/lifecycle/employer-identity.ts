import type { EffectiveEvent } from "../recruiting/types.ts";

/**
 * Employer identity as EVIDENCE, resolved over the whole record (no message text is needed: it works on stored fields and signals).
 *
 * General failure pattern: the name of whoever SENT a message (an applicant-tracking platform, a mailbox provider, an agency's subdomain) is read as the
 * employer, and one employer is written several ways ("Solstice", "Solstice Robotics"). The first merges unrelated applications that share a platform; the
 * second splits one application. Two rules, each weighing evidence instead of trusting a string:
 *
 *  1. THREAD EMPLOYER: a name found only in the sender (`employer:sender-only`) yields to an employer that other mail in the SAME thread names in its text,
 *     but only when the thread names exactly one employer. A name nobody wrote in a message is the weakest evidence there is.
 *  2. ALIASES: two names are one employer when one is a leading-token prefix of the other AND something independent ties them (they share a Gmail thread).
 *     A prefix alone is never enough ("Capital" / "Capital One"), and a short name that could extend to two different employers
 *     is left alone (abstain). The most-supported name wins; ties go to the longer, more specific one.
 * A person's correction or confirmation is never changed.
 */
const settled = (e: EffectiveEvent) => e.corrected || e.confirmed === true;
const tokens = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const isPrefix = (a: string[], b: string[]) => a.length > 0 && a.length < b.length && a.every((t, i) => b[i] === t) && a.join("").length >= 4;
const sameName = (a: string, b: string) => tokens(a).join(" ") === tokens(b).join(" ");

export function resolveEmployers(events: EffectiveEvent[]): EffectiveEvent[] {
  // 1. thread employer
  const grounded = new Map<string, Map<string, { name: string; n: number }>>();
  for (const e of events) {
    if (!e.company || e.outbound || e.signals.includes("employer:sender-only")) continue;
    const m = grounded.get(e.gmailThreadId) ?? new Map();
    const k = tokens(e.company).join(" ");
    m.set(k, { name: e.company, n: (m.get(k)?.n ?? 0) + 1 });
    grounded.set(e.gmailThreadId, m);
  }
  const threadEmployer = (thread: string): string | null => {
    const m = grounded.get(thread);
    if (!m || m.size === 0) return null;
    // a thread naming several spellings of one employer is still one employer: take the longest when every name is a prefix of it
    const names = [...m.values()].map((x) => x.name).sort((a, b) => tokens(b).length - tokens(a).length);
    return names.every((n) => sameName(n, names[0]) || isPrefix(tokens(n), tokens(names[0]))) ? names[0] : null;
  };
  let out = events.map((e) => {
    if (settled(e) || !e.signals.includes("employer:sender-only")) return e;
    const te = threadEmployer(e.gmailThreadId);
    if (!te || (e.company && sameName(e.company, te))) return e;
    return { ...e, company: te, fieldConfidence: { type: e.fieldConfidence?.type ?? e.confidence, role: e.fieldConfidence?.role ?? e.confidence, company: 0.5 }, signals: [...e.signals.filter((s) => s !== "employer:sender-only"), "employer:thread"] };
  });

  // 2. aliases
  type Info = { name: string; support: number; threads: Set<string>; domains: Set<string> };
  const info = new Map<string, Info>();
  for (const e of out) {
    if (!e.company) continue;
    const k = tokens(e.company).join(" ");
    const i = info.get(k) ?? { name: e.company, support: 0, threads: new Set(), domains: new Set() };
    if (!e.signals.includes("employer:sender-only")) i.support++;
    i.threads.add(e.gmailThreadId);
    if (e.senderDomain) i.domains.add(e.senderDomain);
    info.set(k, i);
  }
  // only a shared Gmail thread ties two spellings: a shared sender domain is also what a platform or a mailbox provider has in common with many employers
  const tied = (a: Info, b: Info) => [...a.threads].some((t) => b.threads.has(t));
  const canon = new Map<string, string>();
  for (const [k, short] of info) {
    const longer = [...info.entries()].filter(([k2, x]) => k2 !== k && isPrefix(tokens(short.name), tokens(x.name)) && tied(short, x));
    if (longer.length === 0) continue;
    // abstain when the short name could extend to two employers that are not themselves variants of one another
    const roots = longer.filter(([, x], i) => !longer.some(([, y], j) => j !== i && isPrefix(tokens(x.name), tokens(y.name))));
    if (roots.length !== 1) continue;
    canon.set(k, roots[0][1].name);
  }
  // follow chains and pick the best-supported spelling among a class
  const rootOf = (k: string): string => { const seen = new Set<string>(); let cur = k; while (canon.has(cur) && !seen.has(cur)) { seen.add(cur); cur = tokens(canon.get(cur)!).join(" "); } return cur; };
  out = out.map((e) => {
    if (!e.company || settled(e)) return e;
    const k = tokens(e.company).join(" ");
    const r = rootOf(k);
    return r === k ? e : { ...e, company: info.get(r)?.name ?? e.company, signals: [...e.signals, "employer:alias"] };
  });
  return out;
}
