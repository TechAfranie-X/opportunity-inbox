/**
 * Display repair for text that was decoded with the wrong charset. UTF-8 bytes read as a single-byte charset leave tell-tale lead bytes: a non-breaking space
 * (C2 A0) becomes "Â" plus a space, an apostrophe (E2 80 99) becomes "â€™". Stored roles already contain such artifacts, so repair is applied when text is
 * shown or compared (no re-read of Gmail needed). Idempotent: clean text is returned unchanged.
 */
const MOJIBAKE_PAIRS: Array<[RegExp, string]> = [
  [/â€™/g, "’"], [/â€˜/g, "‘"], [/â€œ/g, "“"], [/â€\u009d|â€/g, "”"], [/â€“/g, "–"], [/â€”/g, "—"], [/â€¦/g, "…"],
  [/Ã©/g, "é"], [/Ã¨/g, "è"], [/Ã¡/g, "á"], [/Ã³/g, "ó"], [/Ã¼/g, "ü"], [/Ã¶/g, "ö"], [/Ã¤/g, "ä"], [/Ã±/g, "ñ"],
];

export function repairText(text: string | null): string | null {
  if (text === null) return null;
  if (!/[ÂÃâ]/.test(text)) return text;
  let out = text;
  for (const [re, to] of MOJIBAKE_PAIRS) out = out.replace(re, to);
  // a stray lead byte left by a non-breaking space: "Â" directly before whitespace, a non-breaking space, or the end
  out = out.replace(/Â(?=[\s ]|$)/g, "").replace(/Â /g, " ");
  return out.replace(/\s+$/, "") === text.replace(/\s+$/, "") ? text : out.trim();
}
