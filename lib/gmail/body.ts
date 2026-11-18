/**
 * Pull readable text out of a Gmail message payload. Used only transiently by
 * extraction — the result is never stored or logged.
 */
export type GmailPayloadPart = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPayloadPart[];
};

const MAX_CHARS = 20_000;

/** The charset a part declares in its Content-Type header, or null. Mail from older clients and some applicant systems is not UTF-8. */
function charsetOf(part: GmailPayloadPart): string | null {
  const ct = part.headers?.find((h) => h.name?.toLowerCase() === "content-type")?.value ?? "";
  return /charset\s*=\s*"?([\w.:-]+)"?/i.exec(ct)?.[1]?.toLowerCase() ?? null;
}

/**
 * Decode a part's bytes with the charset it declares. Decoding windows-1252 as UTF-8 turns an apostrophe in "you're" or a
 * company name into a replacement character, which silently breaks every pattern that depends on it. An unknown charset
 * falls back to UTF-8 rather than failing.
 */
function decode(data: string | undefined, charset: string | null = null) {
  if (!data) return "";
  const bytes = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    // Some senders declare a single-byte charset but send UTF-8 (a non-breaking space then reads "Â" and an apostrophe "â€™"). Bytes that are valid UTF-8 and
    // contain multi-byte sequences are overwhelmingly UTF-8 whatever the label says; genuine single-byte text is almost never valid UTF-8, so it still decodes as declared.
    try {
      const strict = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[^\x00-\x7f]/.test(strict)) return strict;
    } catch { /* not UTF-8: honour the declared charset */ }
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      /* unknown label: fall through to UTF-8 */
    }
  }
  return bytes.toString("utf8");
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", trade: "\u2122",
  eacute: "\u00e9", egrave: "\u00e8", aacute: "\u00e1", oacute: "\u00f3", uuml: "\u00fc", ouml: "\u00f6", auml: "\u00e4", ntilde: "\u00f1",
};

/** Numeric ("&#8217;", "&#x2019;") and the common named entities. An unrecognised one is left as written. */
function decodeEntities(text: string) {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,8}));/g, (whole, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name] ?? NAMED_ENTITIES[String(name).toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function collect(part: GmailPayloadPart | undefined, plain: string[], html: string[]) {
  if (!part) return;
  if (part.mimeType === "text/plain") plain.push(decode(part.body?.data, charsetOf(part)));
  else if (part.mimeType === "text/html") html.push(decode(part.body?.data, charsetOf(part)));
  for (const child of part.parts ?? []) collect(child, plain, html);
}

/**
 * True when the message has a text part whose content Gmail did not inline (it sits behind an attachment id), and no text at
 * all was recovered. The reader then sees an empty message, which looks exactly like "not recruiting"; callers use this to say so.
 */
export function bodyIsUnreadable(payload: GmailPayloadPart | undefined, text: string): boolean {
  if (text.trim().length > 0) return false;
  const stack = [payload];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    if ((part.mimeType === "text/plain" || part.mimeType === "text/html") && part.body?.attachmentId && !part.body.data) return true;
    stack.push(...(part.parts ?? []));
  }
  return false;
}

/** A plain part shorter than this, next to an HTML part three times its length, is a stub ("view this email in your browser"), not the message. */
const STUB_PLAIN_CHARS = 200;

export function extractBodyText(payload: GmailPayloadPart | undefined) {
  const plain: string[] = [];
  const html: string[] = [];
  collect(payload, plain, html);
  const plainText = plain.join("\n").trim();
  const htmlText = html.length > 0 ? htmlToText(html.join("\n")) : "";
  const useHtml = !plainText || (plainText.length < STUB_PLAIN_CHARS && htmlText.length > plainText.length * 3);
  return (useHtml ? htmlText : plainText).slice(0, MAX_CHARS);
}
