import { requisitionOf } from "../identity/represented-employer.ts";
import { notAProcess } from "../semantic/assist.ts";
import type { ExtractedEvent, RecruitingEmail } from "../recruiting/types.ts";
import { employerNamed, endingWording, namedRole, programStage, marketingFact, ownApplicationStatement, ownEnding, studentDeclines, awaitingThem, withdrawalAcknowledged } from "./evidence.ts";
import { messageClass } from "./message-class.ts";

/**
 * The deterministic facts about one message that the product keeps as SIGNALS on its event (a class, or an ending sentence in an update), so the view layer can use them without the text. One
 * function, used both when new mail is read and by the stamp script for stored events, so the two can never disagree.
 */
export function evidenceSignals(m: RecruitingEmail, e: Pick<ExtractedEvent, "type" | "signals" | "outbound">): string[] {
  if (e.outbound) return studentDeclines(m) && !e.signals.includes("student:declines") ? ["student:declines"] : [];
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
  // the sender will act next and asks the reader for nothing
  if (awaitingThem(m)) out.push("awaiting:them");
  // the employer the message names in its own words, and where a programme message sits in its programme's lifecycle
  const en = c ? null : employerNamed(m);
  if (en) out.push(`employer:named:${en}`);
  const ps = programStage(m);
  if (ps) out.push(`program:${ps}`);
  // a position the message itself names (identity evidence for a message whose stored role is generic)
  const named = c && c !== "program-acceptance" ? null : namedRole(m);
  const welcome = !named && c === "program-acceptance" ? /^\s*welcome to (?:the |our )?(.{3,60}?)[!.]?\s*$/i.exec(m.subject)?.[1]?.trim() : null; // (an acceptance that names its programme only in its welcome subject)
  if (named ?? welcome) out.push(`role:named:${named ?? welcome}`);
  // the message states the reader's own application (a receipt) and contains no ending sentence: a rule-typed "rejection" on it is a mistake
  if (!c && ownApplicationStatement(m) && !endingWording(m) && !withdrawalAcknowledged(m)) out.push("own:receipt");
  // a requisition / job number the message states is identity evidence (only the id is kept, never text)
  const req = requisitionOf(`${m.subject}\n${m.bodyText.slice(0, 3000)}`);
  if (req) out.push(`req:${req}`);
  return out.filter((s) => !e.signals.includes(s));
}
