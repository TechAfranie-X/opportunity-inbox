/**
 * Display-only cleanup of message text for the labeling page.
 *
 * It makes the text a human can read: decodes HTML entities, removes invisible formatting characters that carry no
 * meaning, turns leftover HTML into plain text (keeping link targets), and tidies whitespace. It never summarizes,
 * rewrites, classifies or interprets, and it is never used by the extractor or written back to the snapshot.
 *
 * Output is plain text. The page renders it HTML-escaped, so no markup can reach the browser; there is nothing to sanitize
 * beyond that, by construction.
 */

const NAMED: Record<string, string> = {
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", hairsp: " ", numsp: " ", puncsp: " ", MediumSpace: " ",
  zwnj: "", zwj: "", shy: "", lrm: "", rlm: "", NoBreak: "", ZeroWidthSpace: "", InvisibleTimes: "", InvisibleComma: "",
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"',
  ndash: "-", mdash: "-", hellip: "...", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
  laquo: "«", raquo: "»", rarr: "→", larr: "←", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", iexcl: "¡", iquest: "¿",
  eacute: "é", egrave: "è", aacute: "á", agrave: "à", uuml: "ü", ouml: "ö", auml: "ä", ntilde: "ñ", ccedil: "ç", szlig: "ß",
};

/** Characters with no visible or semantic value in running text: zero-width, directional, joiner, filler and soft-hyphen marks. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-︎﻿ﾠ￹-￻]|\uDB40[\uDD00-\uDDEF]/g;
/** Unicode spaces of every width become one ordinary space. */
const SPACES = /[   -   　]/g;

function decodeEntities(text: string): string {
  const once = (s: string) =>
    s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,30}));/g, (whole, dec: string, hex: string, name: string) => {
      if (name) return name in NAMED ? NAMED[name] : whole;
      const code = dec ? Number(dec) : parseInt(hex, 16);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code);
    });
  // Some senders encode twice ("&amp;#847;"); two passes settle it, and a third would risk eating real text.
  return once(once(text));
}

const LOOKS_LIKE_HTML = /<\/?(?:html|head|body|table|tbody|tr|td|th|div|p|br|span|a|img|center|font|b|i|u|strong|em|ul|ol|li|h[1-6]|style|script|meta|link)\b[^>]*>|<!--/i;

/** HTML to readable plain text. Link targets are kept: "text (https://…)". Style, script and comments are dropped. */
function htmlToPlain(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi, (_m, d1: string, d2: string, d3: string, inner: string) => {
      const url = decodeEntities(d1 ?? d2 ?? d3 ?? "").trim();
      const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!/^https?:\/\//i.test(url)) return ` ${label} `;
      return !label || label === url ? ` ${url} ` : ` ${label} (${url}) `;
    })
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(?:p|div|tr|table|ul|ol|li|h[1-6]|blockquote|section|article|header|footer)\s*>/gi, "\n")
    .replace(/<\/\s*t[dh]\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029\u0085\u000B\u000C]/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Clean a message body (multi-line). Deterministic and idempotent. */
export function cleanDisplayText(raw: string): string {
  let text = raw;
  if (LOOKS_LIKE_HTML.test(text)) text = htmlToPlain(text);
  text = decodeEntities(text);
  // Decoding can itself reveal markup that was entity-encoded in the source ("&lt;br&gt;"): treat it the same way.
  if (LOOKS_LIKE_HTML.test(text) && /<\/?(?:br|p|div|table|tr|td|a|span)\b/i.test(text)) text = htmlToPlain(text);
  return tidy(text.replace(INVISIBLE, "").replace(SPACES, " "));
}

/** Clean a one-line field (subject, sender). */
export function cleanDisplayLine(raw: string): string {
  return cleanDisplayText(raw).replace(/\s*\n+\s*/g, " ");
}
