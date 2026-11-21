import { requisitionOf } from "../identity/represented-employer.ts";
import { notAProcess } from "../semantic/assist.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { endingWording, marketingFact, ownApplicationStatement, ownEnding, withdrawalAcknowledged } from "./evidence.ts";
import { messageClass } from "./message-class.ts";

/**
 * The deterministic facts about one message that the product keeps as SIGNALS on its event (a class, or an ending sentence in an update), so the view layer can use them without the text. One
 * function, used both when new mail is read and by the stamp script for stored events, so the two can never disagree.
 */
export function evidenceSignals(m: RecruitingEmail, e: Pick<ExtractedEvent, "type" | "signals" | "outbound">): string[] {
  if (e.outbound) return [];
  const out: string[] = [];
  const c = messageClass(m);
  if (c) out.push(`class:${c}`);
  // an UPDATE that actually ends the application (the reader typed it as a status update): evidence for a proposed ending, never a settled one. The view layer additionally requires a real
  // application anchor at the same employer before it uses this (lib/recruiting/entry-policy.ts proposeMissedEndings).
  if (!c && (e.type === "status_update" || e.type === "follow_up" || e.type === "rejection") && endingWording(m) && !marketingFact(m) && !notAProcess(m)) out.push("ending:wording");
  // the employer ends THIS application in plain voice about the reader's own application: strong enough to settle; and an acknowledged candidate withdrawal
  // (an "applied" receipt that mentions an ending in passing is still a receipt)
  if (!c && ownEnding(m) && !marketingFact(m) && !notAProcess(m) && !(e.type === "applied" && ownApplicationStatement(m))) out.push("ending:own");
  if (!c && withdrawalAcknowledged(m)) out.push("withdrawal:ack");
  // the message states the reader's own application (a receipt) and contains no ending sentence: a rule-typed "rejection" on it is a mistake
  if (!c && ownApplicationStatement(m) && !endingWording(m) && !withdrawalAcknowledged(m)) out.push("own:receipt");
  // a requisition / job number the message states is identity evidence (only the id is kept, never text)
  const req = requisitionOf(`${m.subject}\n${m.bodyText.slice(0, 3000)}`);
  if (req) out.push(`req:${req}`);
  return out.filter((s) => !e.signals.includes(s));
}
