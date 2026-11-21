import { QUOTE_START } from "../reliability/evidence.ts";

/**
 * A message is not one block of text. What the sender wrote NOW, the earlier messages quoted under it, a forwarded message that IS the evidence, the signature (who is speaking) and the
 * boilerplate around them have different temporal and speaker roles. A reader that sees them as one text reports a quoted 2026 rejection as a 2027 event, or a policy sentence as a decision.
 *
 *   current     what the sender wrote in this message (the only text an event may be grounded in)
 *   forwarded   a forwarded or "original message" block, when the message is a forward: the evidence the forward is about (grounded, but said by someone else, earlier)
 *   quoted      earlier messages quoted in a reply: history for understanding who is who, never a new event
 *   signature   the sign-off block: who is speaking and for which organisation
 *   meta        isReply / isForward / hasQuoted and sizes, for context
 * Pure and deterministic; stores nothing.
 */
export type MessageParts = { current: string; forwarded: string; quoted: string; signature: string; meta: { isReply: boolean; isForward: boolean; hasQuoted: boolean; quotedChars: number } };

const FORWARD_SUBJECT = /^\s*(?:fwd?|fw|tr|wg|rv|enc)\s*:/i;
const REPLY_SUBJECT = /^\s*(?:re|aw|sv|antw)\s*:/i;
const FORWARD_MARKER = [/^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/im, /^\s*begin forwarded message:\s*$/im, /^\s*-{2,}\s*original message\s*-{2,}\s*$/im];
const SIGNOFF = /^\s*(?:best(?: regards| wishes)?|kind regards|warm regards|regards|sincerely|thanks(?: so much)?|thank you|cheers|best,)\b[^\n]{0,40}$/im;
const MOBILE_SIG = /^\s*(?:sent from my [\w ]+|get outlook for [\w ]+|--\s*)$/im;
const BOILERPLATE = /\n\s*(?:this (?:e-?mail|message) (?:was intended for|is intended|and any attachments)|you(?:'re| are) receiving this (?:e-?mail|message)|to unsubscribe|unsubscribe|please do not reply to this|confidentiality notice|bewarn|beware: this email)/i;

export function splitMessage(subject: string, bodyText: string): MessageParts {
  const body = bodyText.replace(/\r/g, "");
  let forwarded = "";
  let rest = body;
  let isForward = FORWARD_SUBJECT.test(subject);
  for (const re of FORWARD_MARKER) {
    const m = re.exec(rest);
    if (m && (isForward || m.index < 400)) { forwarded = rest.slice(m.index + m[0].length).trim(); rest = rest.slice(0, m.index); isForward = true; break; }
  }
  // quoted history: the first quote marker cuts it off
  let cut = rest.length;
  for (const re of QUOTE_START) { const m = re.exec(rest); if (m && m.index < cut) cut = m.index; }
  const quoted = rest.slice(cut).trim();
  let current = rest.slice(0, cut);
  // a forward whose own text is empty is its forwarded content (a message sent to oneself, or "Fwd:" with a bare header)
  if (isForward && forwarded === "" && cut < rest.length && current.trim().length < 40) { forwarded = quoted; }
  // boilerplate (a legal footer, an unsubscribe line) is dropped from what was said
  const bp = BOILERPLATE.exec(current);
  if (bp) current = current.slice(0, bp.index);
  // signature: the last sign-off in the closing part of the message
  let signature = "";
  const tailStart = Math.max(0, current.length - 500);
  const tail = current.slice(tailStart);
  const so = SIGNOFF.exec(tail) ?? MOBILE_SIG.exec(tail);
  if (so) { signature = tail.slice(so.index).trim(); current = current.slice(0, tailStart + so.index); }
  return {
    current: current.trim(),
    forwarded,
    quoted: forwarded ? (cut < rest.length ? quoted : "") : quoted,
    signature,
    meta: { isReply: REPLY_SUBJECT.test(subject) || quoted.length > 0, isForward, hasQuoted: quoted.length > 0, quotedChars: quoted.length },
  };
}
