import { EVENT_TYPES, STAGES } from "../recruiting/types.ts";
import { LABEL_FIELDS, LABEL_SOURCES, NOT_APPLICABLE, SOURCE_FOR_DATASET, UNKNOWN, type DatasetKind, type LabelField, type LabelSource } from "../recruiting/ground-truth.ts";

/**
 * Label interchange format (JSONL, one object per line). Contains NO message content and NO predictions, so a
 * second reviewer can label independently and hand back only this file:
 *   {"gmailMessageId":"…","field":"company","value":"Acme","labeler":"reviewer-1"}
 * Unknown keys are rejected on purpose: a stray "prediction" column must never slip into ground truth.
 */
export type LabelInput = { gmailMessageId: string; field: LabelField; value: unknown; labeler: string; source: LabelSource };

const ALLOWED_KEYS = new Set(["gmailMessageId", "field", "value", "labeler", "source", "createdAt"]);
const isNonEmpty = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const withUnknown = (list: readonly string[]) => (v: unknown) => typeof v === "string" && (v === UNKNOWN || v === NOT_APPLICABLE || list.includes(v));

const VALUE_RULES: Record<LabelField, (v: unknown) => boolean> = {
  is_recruiting: (v) => typeof v === "boolean",
  type: withUnknown(EVENT_TYPES),
  company: (v) => v === UNKNOWN || v === NOT_APPLICABLE || isNonEmpty(v, 120),
  role: (v) => v === UNKNOWN || v === NOT_APPLICABLE || isNonEmpty(v, 160),
  opportunity_ref: (v) => v === NOT_APPLICABLE || isNonEmpty(v, 64),
  stage: withUnknown(STAGES),
  event_date: (v) => v === UNKNOWN || v === NOT_APPLICABLE || (typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))),
  actionable: (v) => typeof v === "boolean" || v === NOT_APPLICABLE,
  urgency: (v) => v === "today" || v === "soon" || v === "none" || v === NOT_APPLICABLE,
};

export type ParseResult = { rows: LabelInput[]; errors: string[] };

export function parseLabelsJsonl(text: string, ctx: { kind: DatasetKind; memberIds: Set<string>; defaultLabeler: string; source?: LabelSource }): ParseResult {
  const rows: LabelInput[] = [];
  const errors: string[] = [];
  const allowedSources: LabelSource[] =
    ctx.kind === "dev_challenge" ? [...LABEL_SOURCES].filter((s) => s !== "blind_human") : [SOURCE_FOR_DATASET[ctx.kind]];
  const defaultSource = ctx.source ?? SOURCE_FOR_DATASET[ctx.kind];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const at = `line ${i + 1}`;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { errors.push(`${at}: not valid JSON`); return; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push(`${at}: expected an object`); return; }
    const o = raw as Record<string, unknown>;
    const stray = Object.keys(o).filter((k) => !ALLOWED_KEYS.has(k));
    if (stray.length > 0) { errors.push(`${at}: unexpected key(s) ${stray.join(", ")} (labels must not carry predictions or content)`); return; }
    if (typeof o.gmailMessageId !== "string" || !ctx.memberIds.has(o.gmailMessageId)) { errors.push(`${at}: message is not a member of this dataset`); return; }
    if (typeof o.field !== "string" || !(LABEL_FIELDS as readonly string[]).includes(o.field)) { errors.push(`${at}: unknown field "${String(o.field)}"`); return; }
    const field = o.field as LabelField;
    if (!VALUE_RULES[field](o.value)) { errors.push(`${at}: invalid value for ${field}`); return; }
    const source = (o.source ?? defaultSource) as LabelSource;
    if (!allowedSources.includes(source)) { errors.push(`${at}: source "${String(o.source)}" is not allowed for a ${ctx.kind} dataset`); return; }
    const labeler = typeof o.labeler === "string" && o.labeler.trim() ? o.labeler.trim().slice(0, 40) : ctx.defaultLabeler;
    if (labeler.includes("@")) { errors.push(`${at}: labeler must be an opaque tag, not an address`); return; }
    rows.push({ gmailMessageId: o.gmailMessageId, field, value: o.value, labeler, source });
  });
  return { rows, errors };
}

export function toJsonl(rows: Array<{ gmailMessageId: string; field: string; value: unknown; labeler: string; source: string; createdAt?: Date | string }>) {
  return rows.map((r) => JSON.stringify({ gmailMessageId: r.gmailMessageId, field: r.field, value: r.value, labeler: r.labeler, source: r.source, ...(r.createdAt ? { createdAt: new Date(r.createdAt).toISOString() } : {}) })).join("\n") + (rows.length ? "\n" : "");
}
