import { looksLikePerson } from "../recruiting/company.ts";
import { classifySender } from "../recruiting/entity/vendors.ts";
import type { EffectiveEvent } from "../recruiting/types.ts";
import { coreName, flat, orgsAtDomain, registrable } from "./graph.ts";

/**
 * Learning from the person's own corrections, locally. A mapping is learned from events the person corrected or confirmed ("Looks right"), and
 * only from THEIR events: it lives in their data, is derived at read time (no new storage), and is never shared or applied to anyone else.
 * Guards against poisoning:
 *  - never learn a domain from a shared sender: an ATS, assessment platform, job board, scheduler, free mail, or a domain the graph says belongs to
 *    another organization. A correction on greenhouse-mail.io does not teach "greenhouse-mail.io -> Acme";
 *  - a domain or display name confirmed as two DIFFERENT companies is dropped (conflict), not guessed;
 *  - a person's name is never a display key;
 *  - a mapping is high-weight evidence, not a verdict: a conflicting strong signal still routes to review.
 */
export type LearnedMap = { byDomain: Map<string, string>; byDisplay: Map<string, string> };

export function learnedMappings(events: EffectiveEvent[]): LearnedMap {
  const dom = new Map<string, Set<string>>();
  const disp = new Map<string, Set<string>>();
  const note = (m: Map<string, Set<string>>, k: string, company: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(company);
  for (const e of events) {
    if (e.outbound || !e.company || !(e.corrected || e.confirmed)) continue;
    const company = coreName(e.company) || e.company;
    const d = e.senderDomain;
    const sharedDomain = !d || classifySender(d) !== "employer" || orgsAtDomain(d).some((o) => o.kind !== "employer" || flat(coreName(o.name)) !== flat(company));
    if (!sharedDomain) note(dom, registrable(d), company);
    const display = coreName(e.senderName.replace(/<[^>]+>/g, "").replace(/["']/g, ""));
    if (display.length >= 3 && !looksLikePerson(display)) note(disp, flat(display), company);
  }
  const settle = (m: Map<string, Set<string>>) => new Map([...m].filter(([, v]) => v.size === 1).map(([k, v]) => [k, [...v][0]] as const));
  return { byDomain: settle(dom), byDisplay: settle(disp) };
}
