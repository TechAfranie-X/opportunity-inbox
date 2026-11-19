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
    // the person's own reply borrows its employer from the thread's first message, so it follows the thread's best-evidenced employer too
    if (settled(e) || !(e.signals.includes("employer:sender-only") || e.outbound)) return e;
    const te = threadEmployer(e.gmailThreadId);
    if (!te || (e.company && sameName(e.company, te))) return e;
    return { ...e, company: te, fieldConfidence: { type: e.fieldConfidence?.type ?? e.confidence, role: e.fieldConfidence?.role ?? e.confidence, company: 0.5 }, signals: [...e.signals.filter((s) => s !== "employer:sender-only"), "employer:thread"] };
  });

  // 1b. SENDER IDENTITY: one sender (the same display name from the same domain) that writes for exactly one employer elsewhere in the record. An applicant-tracking
  //     platform delivers mail for many employers under ONE address, so a sender whose grounded names are not all variants of one employer proves nothing.
  const senderKey = (e: EffectiveEvent) => `${tokens(e.senderName ?? "").join(" ")}|${e.senderDomain}`;
  const bySender = new Map<string, string[]>();
  for (const e of out) if (e.company && !e.outbound && e.senderName && !e.signals.includes("employer:sender-only")) bySender.set(senderKey(e), [...(bySender.get(senderKey(e)) ?? []), e.company]);
  const senderEmployer = (e: EffectiveEvent): string | null => {
    const ns = bySender.get(senderKey(e));
    if (!ns || ns.length === 0) return null;
    const longest = [...ns].sort((a, b) => tokens(b).length - tokens(a).length)[0];
    if (!ns.every((n) => sameName(n, longest) || isPrefix(tokens(n), tokens(longest)))) return null;
    // and the sender's own label must carry that employer's name ("Fernbank Games" for "Fernbank Interactive Ltd"): a platform's label ("Recruiting", "Applicant Hub") never does
    const lead = tokens(e.senderName ?? "")[0] ?? "";
    return lead.length >= 4 && lead === tokens(longest)[0] ? longest : null;
  };
  out = out.map((e) => {
    if (settled(e) || e.outbound || !e.senderName || !(e.signals.includes("employer:sender-only") || !e.company)) return e;
    const se = senderEmployer(e);
    if (!se || (e.company && sameName(e.company, se))) return e;
    return { ...e, company: se, fieldConfidence: { type: e.fieldConfidence?.type ?? e.confidence, role: e.fieldConfidence?.role ?? e.confidence, company: 0.5 }, signals: [...e.signals.filter((s) => s !== "employer:sender-only"), "employer:sender-identity"] };
  });

  // 2. aliases
  type Info = { name: string; support: number; threads: Set<string>; domains: Set<string> };
  const info = new Map<string, Info>();
  for (const e of out) {
    if (!e.company) continue;
    const k = tokens(e.company).join(" ");
    const i = info.get(k) ?? { name: e.company, support: 0, threads: new Set(), domains: new Set() };
    if (!e.signals.includes("employer:sender-only")) { if (i.support === 0) i.name = e.company; i.support++; } // spelling: the first one the message text itself uses
    i.threads.add(e.gmailThreadId);
    if (e.senderDomain) i.domains.add(e.senderDomain);
    info.set(k, i);
  }
  // only a shared Gmail thread ties two spellings: a shared sender domain is also what a platform or a mailbox provider has in common with many employers
  // A sender domain ties two spellings only when everything written from it is one employer (all its names equal or prefix-related): a domain that carries
  // unrelated employers is a platform or a mailbox provider, and sharing it proves nothing.
  const related = (x: string, y: string) => { const a = tokens(x), b = tokens(y); return a.join(" ") === b.join(" ") || isPrefix(a, b) || isPrefix(b, a); };
  const domainNames = new Map<string, string[]>();
  for (const e of out) if (e.company && e.senderDomain && !e.signals.includes("employer:sender-only")) domainNames.set(e.senderDomain, [...(domainNames.get(e.senderDomain) ?? []), e.company]);
  // ...and only when the domain is NAMED for the employer ("solmar-energia.example" for "Solmar Energía ..."), not a mailbox or platform that happens to carry one name
  const flat = (x: string) => tokens(x).join("");
  const labelOf = (d: string) => flat(d.split(".").slice(0, -1).slice(-1)[0] ?? "");
  const coherentDomain = (d: string) => { const ns = domainNames.get(d) ?? [], l = labelOf(d); return l.length >= 4 && ns.length > 0 && ns.every((x) => ns.every((y) => related(x, y))) && ns.every((x) => flat(x).startsWith(l) || l.startsWith(flat(x))); };
  const tied = (a: Info, b: Info) => [...a.threads].some((t) => b.threads.has(t)) || [...a.domains].some((d) => b.domains.has(d) && coherentDomain(d));
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
  // the class's spelling: the best supported (written in message text), ties to the longer, more specific name
  const members = new Map<string, string[]>();
  for (const k of info.keys()) members.set(rootOf(k), [...(members.get(rootOf(k)) ?? []), k]);
  const spelling = new Map<string, string>();
  for (const [root, ks] of members) spelling.set(root, ks.map((k) => info.get(k)!).sort((a, b) => b.support - a.support || tokens(b.name).length - tokens(a.name).length)[0].name);
  out = out.map((e) => {
    if (!e.company || settled(e)) return e;
    const k = tokens(e.company).join(" ");
    const r = rootOf(k);
    const name = spelling.get(r) ?? e.company;
    return name === e.company ? e : { ...e, company: name, signals: [...e.signals, "employer:alias"] };
  });
  // CORROBORATION: a name that came from a weak source (sender label, domain, a thread neighbour) and that the TEXT of a different message of the same employer
  // class also writes is confirmed by two independent sources. It stops asking the person about a company the record already agrees on.
  const textBacked = new Map<string, Set<string>>();
  for (const e of out) if (e.company && !e.outbound && !e.signals.includes("employer:sender-only") && (e.fieldConfidence?.company ?? 0) >= 0.5) {
    const k = rootOf(tokens(e.company).join(" ")); textBacked.set(k, (textBacked.get(k) ?? new Set()).add(e.id));
  }
  out = out.map((e) => {
    if (!e.company || settled(e) || (e.fieldConfidence?.company ?? 1) >= 0.6) return e;
    const backers = textBacked.get(rootOf(tokens(e.company).join(" ")));
    if (!backers || [...backers].every((id) => id === e.id)) return e;
    return { ...e, fieldConfidence: { type: e.fieldConfidence?.type ?? e.confidence, role: e.fieldConfidence?.role ?? e.confidence, company: 0.6 }, reviewReasons: (e.reviewReasons ?? []).filter((r) => !/^company:/i.test(r)), signals: [...e.signals, "employer:corroborated"] };
  });
  return out;
}
