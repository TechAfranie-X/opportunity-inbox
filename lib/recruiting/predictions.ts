import { parseSender } from "../opportunities/normalize.ts";
import { extractAll, extractWithReason, type RejectionReason } from "./extract.ts";
import type { EventType, RecruitingEmail } from "./types.ts";
import { EXTRACTOR_VERSION } from "./version.ts";

/**
 * One immutable statement of what the extractor concluded about one message.
 * Privacy: contains no body and, for not-recruiting decisions, no subject either. Only ids, the sender domain
 * and why. (Recruiting decisions carry the same structured fields `recruiting_events` already stores.)
 */
export type Prediction = {
  gmailMessageId: string;
  gmailThreadId: string;
  extractorVersion: string;
  decision: "recruiting" | "not_recruiting";
  outbound: boolean;
  senderDomain: string;
  type: EventType | null;
  company: string | null;
  role: string | null;
  eventDate: Date | null;
  dateKind: "deadline" | "scheduled" | null;
  confidence: number | null;
  fieldConfidence: Record<string, number> | null;
  signals: string[];
  reviewReasons: string[];
};

/**
 * Predictions for every message the extractor looked at, recruiting or not.
 * Not-recruiting rows are what make recruiting recall computable: without them a missed email and an
 * email nobody scanned look identical.
 *
 * Invariant: one prediction per scanned message, derived only from the same inputs `extractAll` uses, so the
 * recruiting rows agree exactly with the events the product shows.
 */
export function buildPredictions(emails: RecruitingEmail[], version = EXTRACTOR_VERSION): Prediction[] {
  const events = extractAll(emails);
  const eventByMessage = new Map(events.map((e) => [e.gmailMessageId, e]));
  const out: Prediction[] = [];
  const seen = new Set<string>();

  for (const email of emails) {
    if (seen.has(email.id)) continue;
    seen.add(email.id);
    const event = eventByMessage.get(email.id);
    if (event) {
      out.push({
        gmailMessageId: event.gmailMessageId,
        gmailThreadId: event.gmailThreadId,
        extractorVersion: version,
        decision: "recruiting",
        outbound: event.outbound,
        senderDomain: event.senderDomain,
        type: event.type,
        company: event.company,
        role: event.role,
        eventDate: event.eventDate,
        dateKind: event.dateKind,
        confidence: event.confidence,
        fieldConfidence: event.fieldConfidence ?? null,
        signals: event.signals,
        reviewReasons: event.reviewReasons ?? [],
      });
      continue;
    }
    // Outbound mail outside any recruiting thread is never ingested, so it is not a decision worth recording.
    if (email.outbound) continue;
    const reason: RejectionReason | "no_recruiting_signal" = extractWithReason(email).reason ?? "no_recruiting_signal";
    out.push({
      gmailMessageId: email.id,
      gmailThreadId: email.threadId,
      extractorVersion: version,
      decision: "not_recruiting",
      outbound: false,
      senderDomain: parseSender(email.from).domain,
      type: null,
      company: null,
      role: null,
      eventDate: null,
      dateKind: null,
      confidence: null,
      fieldConfidence: null,
      signals: [`rejected:${reason}`],
      reviewReasons: [],
    });
  }
  return out;
}
