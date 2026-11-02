/**
 * Date extraction from email text.
 *
 * Dates in recruiting email are timezone-ambiguous ("Friday at 3pm"), so we
 * treat them as "floating" local times and store them as UTC. All display code
 * must therefore format with timeZone: "UTC". Day-level accuracy is what the
 * Today view needs; this is documented as a known limitation.
 */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type DateMention = {
  date: Date;
  hasTime: boolean;
  index: number;
};

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

// "Nov 7", "November 7th, 2026", "Friday, November 7"
const MONTH_DAY = new RegExp(
  `\\b(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+)?(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
  "gi",
);
// "7 November 2026"
const DAY_MONTH = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\.?(?:,?\\s+(\\d{4}))?`,
  "gi",
);
const NUMERIC = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
const WITHIN = /\bwithin\s+(?:the next\s+)?(\d{1,2})\s*(business\s+)?(days?|hours?|weeks?)\b/gi;
const IN_DAYS = /\bin\s+(\d{1,2})\s+(days?)\b/gi;
const WEEKDAY_REF = /\b(?:by|before|on|this|next|until|due)\s+(?:end of day\s+)?(?:(?:the\s+)?(?:coming\s+)?)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
const TOMORROW = /\b(?:by|before|on)?\s*(?:end of day\s+)?(tomorrow|tonight|today)\b/gi;
const TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i;

function utc(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(Date.UTC(y, m, d, h, min));
}

function startOfDayUtc(date: Date) {
  return utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function timeNear(text: string, from: number): { h: number; min: number } | null {
  const window = text.slice(from, from + 60);
  const match = window.match(TIME);
  if (!match) return null;
  let h = Number(match[1]);
  const min = match[2] ? Number(match[2]) : 0;
  const pm = match[3].toLowerCase().startsWith("p");
  if (h < 1 || h > 12 || min > 59) return null;
  if (pm && h < 12) h += 12;
  if (!pm && h === 12) h = 0;
  return { h, min };
}

function resolveYear(received: Date, month: number, day: number, explicit?: string) {
  if (explicit) {
    const y = Number(explicit);
    return y < 100 ? 2000 + y : y;
  }
  // No year: pick the occurrence closest to (and not long before) the email date.
  const year = received.getUTCFullYear();
  const candidate = utc(year, month, day);
  const diffDays = (candidate.getTime() - received.getTime()) / 86_400_000;
  if (diffDays < -60) return year + 1;
  return year;
}

function valid(y: number, m: number, d: number) {
  const dt = utc(y, m, d);
  return dt.getUTCMonth() === m && dt.getUTCDate() === d;
}

/** Find every date-like mention in `text`, resolved relative to `received`. */
export function findDateMentions(text: string, received: Date): DateMention[] {
  const out: DateMention[] = [];
  const push = (y: number, m: number, d: number, index: number, end: number) => {
    if (!valid(y, m, d)) return;
    const t = timeNear(text, end);
    out.push({
      date: t ? utc(y, m, d, t.h, t.min) : utc(y, m, d),
      hasTime: Boolean(t),
      index,
    });
  };

  for (const m of text.matchAll(MONTH_DAY)) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    push(resolveYear(received, month, day, m[3]), month, day, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(DAY_MONTH)) {
    const month = MONTHS[m[2].toLowerCase()];
    const day = Number(m[1]);
    push(resolveYear(received, month, day, m[3]), month, day, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(NUMERIC)) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    if (month < 0 || month > 11) continue;
    push(resolveYear(received, month, day, m[3]), month, day, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(WITHIN)) {
    const n = Number(m[1]);
    const unit = m[3].toLowerCase();
    const base = startOfDayUtc(received);
    const days = unit.startsWith("week") ? n * 7 : unit.startsWith("hour") ? Math.ceil(n / 24) : n;
    out.push({ date: new Date(base.getTime() + days * 86_400_000), hasTime: false, index: m.index });
  }
  for (const m of text.matchAll(IN_DAYS)) {
    const base = startOfDayUtc(received);
    out.push({ date: new Date(base.getTime() + Number(m[1]) * 86_400_000), hasTime: false, index: m.index });
  }
  for (const m of text.matchAll(WEEKDAY_REF)) {
    const target = WEEKDAYS.indexOf(m[1].toLowerCase());
    const base = startOfDayUtc(received);
    let delta = (target - base.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;
    const t = timeNear(text, m.index + m[0].length);
    const date = new Date(base.getTime() + delta * 86_400_000);
    out.push({
      date: t ? new Date(date.getTime() + (t.h * 60 + t.min) * 60_000) : date,
      hasTime: Boolean(t),
      index: m.index,
    });
  }
  for (const m of text.matchAll(TOMORROW)) {
    const base = startOfDayUtc(received);
    const offset = m[1].toLowerCase() === "tomorrow" ? 1 : 0;
    out.push({ date: new Date(base.getTime() + offset * 86_400_000), hasTime: false, index: m.index });
  }

  return out.sort((a, b) => a.index - b.index);
}

const DEADLINE_CUES = /\b(?:by|before|deadline|due|expires?|expiring|no later than|within|until|complete(?:d)? (?:by|within)|respond by|decision)\b/i;
const SCHEDULE_CUES = /\b(?:scheduled|confirmed|on|at|for|your interview|starts?|begins?)\b/i;

/**
 * Pick the most plausible date for the given intent.
 * `deadline` prefers mentions near deadline cues; `scheduled` prefers dates
 * near schedule cues. Falls back to the first future mention.
 */
export function pickDate(
  text: string,
  received: Date,
  intent: "deadline" | "scheduled",
): DateMention | null {
  const floor = startOfDayUtc(received).getTime() - 86_400_000;
  const mentions = findDateMentions(text, received).filter(
    (m) => m.date.getTime() >= floor,
  );
  if (mentions.length === 0) return null;

  const cue = intent === "deadline" ? DEADLINE_CUES : SCHEDULE_CUES;
  const scored = mentions.map((m) => {
    const before = text.slice(Math.max(0, m.index - 50), m.index + 8);
    let score = 0;
    if (cue.test(before)) score += 2;
    if (intent === "scheduled" && m.hasTime) score += 2;
    if (intent === "deadline" && DEADLINE_CUES.test(before)) score += 1;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score || a.m.index - b.m.index);
  return scored[0].m;
}
