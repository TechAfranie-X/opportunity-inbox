import { candidateEvent } from "../reliability/assess.ts";
import { NEAR_MISS, NEAR_MISS_WEAK, isNearMiss, isWeakNearMiss } from "../reliability/flags.ts";
import type { VerifiedOutput } from "../recruiting/reader/types.ts";
import type { EventType, ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { SECOND_READER_NO, SECOND_READER_YES } from "./consensus.ts";
import { looksLikePerson } from "../recruiting/company.ts";
import { findDateMentions } from "../recruiting/dates.ts";
import { usable } from "./port.ts";
import { outboundEvent } from "../recruiting/extract.ts";
import { applyTextFacts, studentAcceptance } from "../reliability/facts.ts";
import { employerProvenance } from "../reliability/grounding.ts";

/**
 * Assist mode: the language model's verified opinion changes what the product SHOWS, not just what it asks. It is a second reader with real authority in
 * exactly four places, each guarded by the deterministic verifier (an opinion reaches here only if its evidence quote was found in the message):
 *
 *   rules found nothing, model high certainty yes   -> a pipeline event of the model's type (signal "semantic:event"); the refinement gates still apply
 *   rules found nothing, model medium certainty yes -> a counted "possibly recruiting" item (a person decides)
 *   near miss, model says no                        -> excluded from review ("semantic:excluded"): the model read it and it is not recruiting
 *   near miss, model says yes                       -> weak: counted; high certainty: promoted to a pipeline event
 *   rules event typed only "status_update", model high certainty with a specific type -> the type is made specific ("semantic:type")
 * Everything else is as in consensus.ts (doubt on disagreement, no effect on agreement). Dates, employer and role come from deterministic code and from
 * the verified reading (lib/semantic/employer.ts), never from this function. The message itself is never stored or altered.
 */
export const SEMANTIC_EVENT = "semantic:event";
export const SEMANTIC_EXCLUDED = "semantic:excluded";
export const isSemanticExcluded = (e: { signals: string[] }) => e.signals.includes(SEMANTIC_EXCLUDED);

const UNREADABLE = /could not read/;
const asEventType = (t: string | null): EventType => (t === "withdrawn" ? "withdrawn" : ((t ?? "status_update") as EventType));

const CONFIRMED_TIME = /\b(?:confirmed|you(?:['’]re| are) (?:booked|scheduled|set|all set)|(?:is|are) (?:scheduled|booked|set) for|scheduled for|see you (?:on|at|then|there)|looking forward to (?:speaking|meeting|seeing))\b/i;
const CHOOSING = /\b(?:which (?:one |time |slot )?(?:works|do you prefer|suits)|choose|pick|select|let me know (?:which|what|when)|reply with|availab(?:le|ility)|options?|or\b[^.\n]{0,30}\b(?:at|on)\b)\b/i;
/**
 * Whether an interview message offers choices ("invite") or fixes a time ("scheduled") is a fact of the text, not of meaning, so it is decided here and not by the
 * model: a confirmation phrase plus an explicit date or time is scheduled; offered choices without a confirmation is an invitation; anything else keeps the model's type.
 */
export function interviewKind(m: Pick<RecruitingEmail, "subject" | "bodyText" | "receivedAt">, modelType: EventType): EventType {
  if (modelType !== "interview_invite" && modelType !== "interview_scheduled") return modelType;
  const text = `${m.subject}\n${m.bodyText}`;
  const timed = findDateMentions(text, m.receivedAt).length > 0 || /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.test(text);
  if (CONFIRMED_TIME.test(text) && timed && !CHOOSING.test(m.bodyText.split(/\n/).slice(0, 2).join(" "))) return "interview_scheduled";
  if (CHOOSING.test(text) && !CONFIRMED_TIME.test(text)) return "interview_invite";
  return modelType;
}

function semanticEvent(m: RecruitingEmail, op: VerifiedOutput): ExtractedEvent {
  const base = candidateEvent(m, "strong", "", []);
  const person = base.company ? looksLikePerson(base.company) : false; // a signature name is not an employer
  return applyTextFacts(m, employerProvenance(m, {
    ...base,
    company: person ? null : base.company,
    type: interviewKind(m, asEventType(op.type)),
    confidence: 0.72,
    fieldConfidence: { type: 0.72, company: base.fieldConfidence?.company ?? 0, role: 0 },
    reviewReasons: [],
    signals: [SEMANTIC_EVENT, `semantic:certainty:${op.certainty}`],
  }));
}

const LOW_INFORMATION = new Set<string>(["status_update", "applied", "follow_up"]);
const DECISIVE = new Set<string>(["rejection", "offer", "withdrawn", "interview_invite", "interview_scheduled", "assessment"]);
export function applyAssist(events: ExtractedEvent[], emails: RecruitingEmail[], opinions: Map<string, VerifiedOutput>): ExtractedEvent[] {
  if (opinions.size === 0) return events;
  const byId = new Map(emails.map((m) => [m.id, m] as const));
  const out = events.map((e) => {
    const op = opinions.get(e.gmailMessageId);
    const m = byId.get(e.gmailMessageId);
    if (!usable(op) || e.outbound || !m) return e;
    if (isNearMiss(e)) {
      if (UNREADABLE.test((e.reviewReasons ?? []).join(" "))) return e;
      if (!op.recruiting) return { ...e, signals: [...e.signals, "semantic:no", SEMANTIC_EXCLUDED] };
      if (op.certainty === "high") return { ...semanticEvent(m, op), company: e.company ?? semanticEvent(m, op).company };
      if (isWeakNearMiss(e)) return { ...e, signals: [...e.signals.filter((s) => s !== NEAR_MISS_WEAK), "semantic:yes"], reviewReasons: [SECOND_READER_YES] };
      return e;
    }
    if (!op.recruiting) return { ...e, reviewReasons: [...new Set([...(e.reviewReasons ?? []), SECOND_READER_NO])], signals: [...e.signals, "semantic:no"] };
    // A low-information type (a bare status, a receipt, a nudge) is made specific when the verified reading is confident about a decisive stage: the same subject
    // line ("Your application to X") carries a receipt one day and a rejection the next, and only the body tells them apart.
    const generic = LOW_INFORMATION.has(e.type) && op.certainty === "high" && !!op.type && op.type !== e.type && (e.type === "status_update" || DECISIVE.has(op.type));
    return applyTextFacts(m, { ...e, type: interviewKind(m, generic ? asEventType(op.type) : e.type), signals: [...e.signals, generic ? "semantic:type" : "semantic:agree"] });
  });
  const have = new Set(out.map((e) => e.gmailMessageId));
  const added = emails.flatMap((m) => {
    if (m.outbound || have.has(m.id)) return [];
    const op = opinions.get(m.id);
    if (!usable(op) || !op.recruiting) return [];
    return [op.certainty === "high" ? semanticEvent(m, op) : candidateEvent(m, "strong", SECOND_READER_YES, ["semantic:yes"])];
  });
  void NEAR_MISS;
  // The person's own replies in a thread the MODEL recognised as recruiting: the rule reader only keeps a reply when a rule event anchors its thread, so a thread the
  // rules missed (and the model found) would lose the person's answer (an acceptance, a withdrawal). They are kept the same way, from the model-found anchor.
  const all = [...out, ...added];
  const anchors = new Map<string, ExtractedEvent>();
  for (const e of all) if (!e.outbound && !anchors.has(e.gmailThreadId)) anchors.set(e.gmailThreadId, e);
  const haveAfter = new Set(all.map((e) => e.gmailMessageId));
  const replies = emails.flatMap((m) => {
    const anchor = anchors.get(m.threadId);
    return m.outbound && anchor && !haveAfter.has(m.id) ? [studentAcceptance(m, outboundEvent(m, anchor))] : [];
  });
  return added.length > 0 || replies.length > 0 ? [...all, ...replies].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()) : out;
}
