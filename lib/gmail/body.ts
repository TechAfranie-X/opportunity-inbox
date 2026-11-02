/**
 * Pull readable text out of a Gmail message payload. Used only transiently by
 * extraction — the result is never stored or logged.
 */
export type GmailPayloadPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
};

const MAX_CHARS = 20_000;

function decode(data: string | undefined) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function collect(part: GmailPayloadPart | undefined, plain: string[], html: string[]) {
  if (!part) return;
  if (part.mimeType === "text/plain") plain.push(decode(part.body?.data));
  else if (part.mimeType === "text/html") html.push(decode(part.body?.data));
  for (const child of part.parts ?? []) collect(child, plain, html);
}

export function extractBodyText(payload: GmailPayloadPart | undefined) {
  const plain: string[] = [];
  const html: string[] = [];
  collect(payload, plain, html);
  const text = plain.join("\n").trim() || htmlToText(html.join("\n"));
  return text.slice(0, MAX_CHARS);
}
