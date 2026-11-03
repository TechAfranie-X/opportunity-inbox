import { cleanRole } from "./company.ts";

/**
 * Role (what the application, offer or interview is FOR) as a span extracted from the frame the sender wrote around it.
 *
 * Why frames: roles are not a vocabulary. "Launch Intern", "2026 Explore HRT program", "Handshake AI Fellowship" and
 * "Internship - UX Design" share no word list, but every sender puts them in the same few syntactic slots:
 * "application for X", "the role of X", "move forward with other candidates for X", "your X offer", "interest in the X position".
 * A keyword vocabulary only finds titles that look like the ones it was written from; a frame finds whatever sits in the slot,
 * and the validation below decides whether that thing is a role at all.
 */

// A span of title-ish text, ended by sentence punctuation, a clause opener, a following preposition or a new sentence.
const END = String.raw`(?=\s*(?:[.!?;](?:\s|$)|,\s+(?:we|and|but|please|you|your|as|which|so|i|our|unfortunately|thank)\b|\s+(?:at|with|for|on|in|has|have|was|is|are|will|because|since|after)\s|\s+(?:role|position|opening|opportunity|job)\b|\s+(?:and|to|that|where|who|so|but|or)\s+[a-z]|\s+(?:We|Our|Your|You|Please|Thank|Thanks|The|This|As|If|Unfortunately|Hi|Dear)\s+[a-z]|\n|$))`;
const SPAN = String.raw`([A-Z0-9][^\n]{2,110}?)${END}`;
const THE = String.raw`(?:the\s+|our\s+|an?\s+)?`;
const NOUN = String.raw`(?:role|position|job|opening|opportunity|internship|program(?:me)?)`;

type Frame = { re: RegExp; explicit: boolean };

/** Most reliable first. `explicit` frames name the slot as a role/position, so any capitalised phrase there is a role. */
const FRAMES: Frame[] = [
  { re: new RegExp(String.raw`\b${NOUN}\s+(?:of|as|titled|called|named)\s*:?\s*${SPAN}`), explicit: true },
  { re: new RegExp(String.raw`\bfollowing(?:\s+${NOUN})?\s*:\s*${SPAN}`), explicit: true },
  { re: new RegExp(String.raw`\binterest\s+in\s+${THE}${SPAN.replace(END, String.raw`\s+${NOUN}\b`)}`), explicit: true },
  { re: new RegExp(String.raw`\b(?:other|more|further|any)\s+candidates?\s+(?:for|in)\s+${THE}${SPAN}`), explicit: false },
  { re: new RegExp(String.raw`\b(?:move|moving|proceed|proceeding)\s+forward\s+with\s+your\s+(?:application|candidacy)\s+(?:for|to)\s+${THE}${SPAN}`), explicit: false },
  { re: new RegExp(String.raw`\b(?:application|candidacy|applying|applied|apply|selected|accepted)(?:\s+\w+){0,3}?\s+(?:for|to|as)\s+${THE}${SPAN}`, "i"), explicit: false },
  { re: new RegExp(String.raw`\b[Yy]our\s+${SPAN.replace(END, String.raw`\s+(?:offer|application|interview|assessment|candidacy|invitation)\b`)}`), explicit: false },
];

const ROLE_WORD = /\b(?:intern(?:ship)?s?|externship|engineer(?:ing)?|developer|analyst|scientist|designer|manager|associate|researcher|consultant|architect|specialist|co-?op|fellow(?:ship)?|apprentice(?:ship)?|programmer|program(?:me)?|academy|institute|scholars?|trainee|officer|assistant|coordinator|representative|director|lead)\b/i;
const REQUISITION = /\b[A-Z]{0,3}-?\d{4,}\b/;
const YEAR = /\b20\d\d\b/;
const GENERIC = /^(?:the |this |that |our |your |a |an )|^(?:position|role|job|opportunity|opening|application|interview|offer|assessment)$/i;

/** Is this span plausibly a role, and not a company, a link, a sentence or a generic noun? */
function plausible(span: string, company: string | null, explicit: boolean) {
  const words = span.split(/\s+/);
  if (span.length < 4 || span.length > 110 || words.length > 14) return false;
  if (GENERIC.test(span) || /@|https?:|www\./i.test(span)) return false;
  const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (company && flat(span) === flat(company)) return false;
  if (explicit) return /[A-Za-z]{3}/.test(span);
  // a generic "for X" slot also holds companies, events and links: demand a role-like signal
  return ROLE_WORD.test(span) || REQUISITION.test(span) || YEAR.test(span);
}

/** Roles from frames. Returns null when no frame holds a plausible role. */
export function roleFromFrames(text: string, company: string | null): string | null {
  const flatText = text.replace(/[ \t]+/g, " ");
  for (const { re, explicit } of FRAMES) {
    for (const m of flatText.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
      let span = (m[1] ?? "").trim();
      // "Tiffany & Co. - Internship - UX Design": the sender names itself first, then the role
      if (company) span = span.replace(new RegExp(String.raw`^${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['’]s)?\s*[-–:|,]?\s*`, "i"), "");
      span = span.replace(/\s+(?:position|role|opening|opportunity)$/i, "");
      if (!plausible(span, company, explicit)) continue;
      const cleaned = cleanRole(span, company);
      if (cleaned) return cleaned;
    }
  }
  return null;
}
