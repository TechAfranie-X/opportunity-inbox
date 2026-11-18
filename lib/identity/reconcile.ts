import { sameOrg } from "../recruiting/reader/reconcile.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import type { VerifiedReading } from "../semantic/reading.ts";
import { flat, registrable } from "./graph.ts";
import type { LearnedMap } from "./learned.ts";
import { classifyOrgName } from "./classify.ts";
import { canonicalOrg, orgsNamed } from "./graph.ts";
import { lookupKeys } from "./names.ts";
import { brandFor } from "./resolve.ts";
import { extendsVendor, notEmployerReason, resolveIdentity } from "./resolver.ts";

export type IdentityContext = {
  /** Companies the person already has opportunities with. */
  known: string[];
  learned: LearnedMap;
};

function vendorDomains(events: ExtractedEvent[], emails: Map<string, RecruitingEmail>): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.outbound || !e.company || (e.fieldConfidence?.company ?? e.confidence) < KNOWN_FROM || !emails.has(e.gmailMessageId)) continue;
    const dom = registrable(e.senderDomain);
    (seen.get(dom) ?? seen.set(dom, new Set()).get(dom)!).add(flat(e.company));
  }
  return new Set([...seen].filter(([, v]) => v.size >= 2).map(([d]) => d));
}

export const FC_KNOWN = 0.8;
export const FC_LIKELY = 0.5;
export const FC_REVIEW = 0.4;
const KNOWN_FROM = 0.6; // the product's own threshold for "known" (lib/recruiting/presentation.ts)

/**
 * Writes the resolver's verdict into events as calibrated company state. The rule reader's confident reading is never overturned silently:
 *   known   -> the company, confidence 0.8 (no review item: it understood)
 *   likely  -> the company, confidence 0.5 ("Likely X, confirm")
 *   review  -> the leading candidate, confidence 0.4, with both candidates named
 *   unknown -> a weak guess from the rules is withdrawn only when its sole support was a generic channel; a confident rules reading is kept
 * Where a confident rules reading and a known/likely verdict name different companies, the rules stand and the disagreement is flagged.
 */
export function applyIdentity(events: ExtractedEvent[], emails: Map<string, RecruitingEmail>, readings: Map<string, VerifiedReading>, ctx: IdentityContext): ExtractedEvent[] {
  // Invariant I5, as the rule reader's batch step uses it: a sender domain that serves two or more distinct confident employers is a vendor, not an employer.
  const learnedVendors = vendorDomains(events, emails);
  const byThread = new Map<string, ExtractedEvent[]>();
  for (const e of events) (byThread.get(e.gmailThreadId) ?? byThread.set(e.gmailThreadId, []).get(e.gmailThreadId)!).push(e);
  return events.map((e0) => {
    let e = e0;
    const mail = emails.get(e.gmailMessageId);
    if (!mail || e.outbound) return e;
    const threadCompanies = (byThread.get(e.gmailThreadId) ?? []).filter((o) => o !== e0 && o.company && (o.fieldConfidence?.company ?? o.confidence) >= KNOWN_FROM).map((o) => o.company!);
    const r = resolveIdentity({ from: mail.from, replyTo: mail.replyTo, subject: mail.subject, body: mail.bodyText, threadCompanies, knownCompanies: ctx.known, learned: ctx.learned, learnedVendors, semantic: readings.get(e.gmailMessageId) });
    const fc0 = e.fieldConfidence ?? { type: e.confidence, company: e.confidence, role: e.confidence };
    // The rules' own guess is vetoed when it is a vendor, an agency, a department word or a kind of message: that is a channel, not an employer.
    const vetoed = !!e.company && notEmployerReason(e.company) !== null;
    const fc = vetoed ? { ...fc0, company: 0 } : fc0;
    const rulesConf = fc.company;
    if (vetoed) e = { ...e, company: null, fieldConfidence: fc, signals: [...e.signals, "identity:vetoed"] };
    const reason = (text: string) => [...new Set([...(e.reviewReasons ?? []), text])];
    // A program, event, fellowship or publication is not an employer (structural: its head noun, lib/identity/classify.ts). Run by a known organization, it is
    // that organization, as a hypothesis; with no known sponsor it stays as named but is never Known.
    // (a name the graph already knows as an employer is one: "Khan Academy" is an organization, not a program)
    const program = e.company && !lookupKeys(e.company).some((k) => orgsNamed(k).some((o) => o.kind === "employer")) ? classifyOrgName(e.company) : null;
    if (e.company && program?.kind === "program") {
      const sponsor = program.sponsor;
      const known = sponsor ? lookupKeys(sponsor).map((k) => orgsNamed(k).find((o) => o.kind === "employer")).find(Boolean) : undefined;
      const sponsorName = known ? canonicalOrg(known).name : sponsor && brandFor(sponsor) ? sponsor : null;
      const base = { ...e, signals: [...e.signals, "identity:program"] };
      if (sponsorName) return { ...base, company: sponsorName, fieldConfidence: { ...fc, company: FC_LIKELY }, reviewReasons: reason(`"${e.company}" is a program or event run by ${sponsorName}. Please confirm the organization.`) };
      return { ...base, fieldConfidence: { ...fc, company: Math.min(fc.company, FC_LIKELY) }, reviewReasons: reason(`"${e.company}" looks like a program or event rather than an employer. The organization behind it may be different.`) };
    }
    const signals = [...e.signals, `identity:${r.state}`, ...r.classes.map((c) => `identity:class:${c}`)];
    const team = r.team ? [...signals, "identity:team"] : signals;
    const via = r.intermediaries.filter((i) => i.kind !== "recruiter" && i.kind !== "team").map((i) => i.name);
    const channel = via.length > 0 ? `Sent through ${via.join(" and ")}, which ${via.length > 1 ? "are" : "is"} not the employer. ` : "";

    if (!vetoed && e.company && rulesConf >= FC_LIKELY && extendsVendor(e.company)) {
      // the name extends a platform's ("Handshake AI"): possibly a division of the platform, possibly another company. Never shown as known.
      return { ...e, fieldConfidence: { ...fc, company: Math.min(rulesConf, FC_LIKELY) }, signals: [...team, "identity:vendor_extension"], reviewReasons: reason(`${e.company} may be a division of a platform rather than the employer. Please confirm.`) };
    }
    if (r.state === "unknown" || !r.employer) {
      const guessScore = e.company ? (r.candidates.find((c) => sameOrg(c.name, e.company)))?.score ?? 0 : 1;
      if ((e.company && rulesConf < KNOWN_FROM && guessScore < 0.4) || vetoed) {
        return { ...e, company: null, fieldConfidence: { ...fc, company: 0.3 }, signals: [...team, "identity:withdrawn"], reviewReasons: reason(`${channel}The company is not clear from this message.`) };
      }
      return { ...e, signals: team };
    }
    const rulesAgrees = !!e.company && sameOrg(e.company, r.employer.name);
    const rulesConfident = !!e.company && rulesConf >= KNOWN_FROM;
    if (rulesConfident && !rulesAgrees) return { ...e, signals: [...team, "identity:conflict"], reviewReasons: reason(`Two readers disagree about the company (${e.company} or ${r.employer.name}). Check which is right.`) };
    if (rulesAgrees && rulesConfident) {
      // confident rules and the same verdict, except that the name extends a vendor's: it is shown as likely, not known
      if (extendsVendor(e.company!)) return { ...e, fieldConfidence: { ...fc, company: FC_LIKELY }, signals: [...team, "identity:vendor_extension"], reviewReasons: reason(`${e.company} may be a division of a platform rather than the employer. Please confirm.`) };
      return { ...e, signals: team };
    }

    if (r.state === "known") return { ...e, company: r.employer.name, fieldConfidence: { ...fc, company: FC_KNOWN }, signals: team };
    if (r.state === "likely") return { ...e, company: r.employer.name, fieldConfidence: { ...fc, company: FC_LIKELY }, signals: team, reviewReasons: reason(`${channel}${r.employer.name} appears to be the employer; please confirm.`) };
    return { ...e, company: r.employer.name, fieldConfidence: { ...fc, company: FC_REVIEW }, signals: team, reviewReasons: reason(`${channel}This could be ${r.employer.name} or ${r.alternative?.name ?? "another company"}. Check which.`) };
  });
}
