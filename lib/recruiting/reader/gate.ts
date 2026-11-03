import type { RecruitingEmail } from "../types.ts";

/**
 * Routing gate: decides which messages the model reads. The only goal is to keep recruiting recall at (essentially) 100%
 * while spending fewer calls. A message the rules already call recruiting always passes, so the model can always
 * second-guess a rules "yes".
 */
export type GateId = "G0-loose" | "G1-process" | "G2-process-unbulk";

const ATS = /(greenhouse|lever\.co|ashbyhq|icims|myworkday|workday|smartrecruiters|jobvite|taleo|successfactors|handshake|interfolio|modernloop|hackerrank|codesignal|hirevue|12twenty|oraclecloud|brassring|breezy|workable|bamboohr)/i;

const LOOSE = /\b(appl(y|ied|ies|ication|ications|icant|icants|ying)|candidate|candidacy|interview|assessment|coding challenge|hackerrank|codesignal|position|opening|offer|intern(ship)?s?|recruit\w*|hiring|fellowship|screening|onboarding|background (check|verification)|resume|talent acquisition|your submission)\b/i;

/** Words that describe a person's own hiring process, not an employer's marketing. */
const PROCESS = /\b(your (application|candidacy|submission|interview|assessment|resume|profile)|you (applied|have applied|started|submitted|completed)|(thank you|thanks) for (applying|your interest|your application|your submission)|appl(y|ied|ying|ication|ications|icant|icants)\b|candidate|candidacy|interview|assessment|coding challenge|online test|recruiter|talent acquisition|hiring (manager|team)|requisition|next steps|unable to (move|consider)|move forward|moving forward|regret to inform|offer (letter|of employment)|position (has been )?filled)\b/i;

/** Mail that addresses the reader about their own process. */
const PERSONAL = /\b(your (application|candidacy|submission|interview|assessment)|you (applied|have applied|started|submitted)|thank you for (applying|your application)|we received your)\b/i;

export function passGate(id: GateId, email: Pick<RecruitingEmail, "from" | "subject" | "bodyText">, rulesYes: boolean): boolean {
  if (rulesYes) return true;
  const ats = ATS.test(email.from);
  switch (id) {
    case "G0-loose":
      return ats || LOOSE.test(`${email.subject}\n${email.bodyText.slice(0, 2500)}`);
    case "G1-process":
      return ats || PROCESS.test(`${email.subject}\n${email.bodyText.slice(0, 1500)}`);
    case "G2-process-unbulk": {
      const text = `${email.subject}\n${email.bodyText.slice(0, 1500)}`;
      if (ats) return true;
      if (!PROCESS.test(text)) return false;
      return !(/unsubscribe/i.test(email.bodyText) && !PERSONAL.test(text)); // bulk mail that never speaks about the reader's own process
    }
  }
}
