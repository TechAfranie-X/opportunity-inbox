import { EVENT_TYPES, type EventType } from "./types.ts";
import { NOT_APPLICABLE, UNKNOWN, type LabelField } from "./ground-truth.ts";
import type { EventCorrection } from "./opportunity.ts";

/** Validate the jsonb blob we read back from Postgres before trusting it. */
export function parseCorrection(raw: unknown): EventCorrection | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: EventCorrection = {};
  if (r.ignored === true) out.ignored = true;
  if (r.confirmed === true) out.confirmed = true;
  if (typeof r.type === "string" && (EVENT_TYPES as string[]).includes(r.type)) out.type = r.type as EventType;
  if (typeof r.company === "string" && r.company.trim()) out.company = r.company.trim().slice(0, 120);
  if (r.role === null) out.role = null;
  else if (typeof r.role === "string") out.role = r.role.trim().slice(0, 160) || null;
  if (r.eventDate === null) out.eventDate = null;
  else if (typeof r.eventDate === "string") {
    const d = new Date(r.eventDate);
    if (!Number.isNaN(d.getTime())) out.eventDate = d;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function serializeCorrection(c: EventCorrection): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.ignored) out.ignored = true;
  if (c.confirmed) out.confirmed = true;
  if (c.type !== undefined) out.type = c.type;
  if (c.company !== undefined) out.company = c.company;
  if (c.role !== undefined) out.role = c.role;
  if (c.eventDate !== undefined) out.eventDate = c.eventDate ? c.eventDate.toISOString() : null;
  return out;
}

/** Which fields a correction touched — drives per-field accuracy metrics. */
export function correctedFields(c: EventCorrection | undefined): string[] {
  if (!c) return [];
  if (c.ignored) return ["ignored"];
  return (["type", "company", "role", "eventDate"] as const).filter((k) => c[k] !== undefined);
}

/* ------------------------------------------------------------------------------------------------------------
 * Corrections as structured labels.
 *
 * The `correction` blob above is the serving overlay. These functions produce the evidence log: append-only label
 * rows (source `user_correction`) that remember what the person said, against the prediction they were looking at.
 * Nothing here changes any rule or threshold: learning from labels is a later, deliberate step.
 *
 * Invariants:
 *  - An untouched field is unlabeled, never assumed correct. Only an explicit change, revert or confirmation counts.
 *  - A label never replaces the prediction it refers to; both are kept.
 * ------------------------------------------------------------------------------------------------------------ */

export type FieldValues = { type: EventType; company: string | null; role: string | null; eventDate: Date | null };
export type LabelDraft = { field: LabelField; value: unknown; kind: "correction" | "revert" | "confirmation" };

/** How an editable field is written as a label value. */
export function encodeField(field: "type" | "company" | "role" | "event_date", v: FieldValues): unknown {
  switch (field) {
    case "type": return v.type;
    case "company": return v.company ?? UNKNOWN;
    case "role": return v.role ?? NOT_APPLICABLE;
    case "event_date": return v.eventDate ? v.eventDate.toISOString() : NOT_APPLICABLE;
  }
}
const FIELDS = ["type", "company", "role", "event_date"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Labels implied by saving the edit form. Prior = the person's latest own label per field (if any). */
export function draftsFromEdit(predicted: FieldValues, edit: FieldValues, prior: Partial<Record<LabelField, unknown>>): LabelDraft[] {
  const drafts: LabelDraft[] = [];
  for (const field of FIELDS) {
    const p = encodeField(field, predicted);
    const e = encodeField(field, edit);
    if (same(prior[field], e)) continue; // already on record with this value: the log does not repeat itself
    if (!same(p, e)) drafts.push({ field, value: e, kind: "correction" });
    else if (prior[field] !== undefined) drafts.push({ field, value: e, kind: "revert" }); // changed their mind back to the prediction
  }
  return drafts;
}

/** "Not recruiting": the one fact the person asserts. */
export function draftsFromIgnore(prior: Partial<Record<LabelField, unknown>>): LabelDraft[] {
  return prior.is_recruiting === false ? [] : [{ field: "is_recruiting", value: false, kind: "correction" }];
}

/** "Looks right": explicit confirmation of what is shown. Provenance stays user_correction: the person saw the prediction. */
export function draftsFromConfirmation(shown: FieldValues, prior: Partial<Record<LabelField, unknown>>): LabelDraft[] {
  const drafts: LabelDraft[] = [];
  if (prior.is_recruiting !== true) drafts.push({ field: "is_recruiting", value: true, kind: "confirmation" });
  for (const field of FIELDS) {
    const v = encodeField(field, shown);
    if (!same(prior[field], v)) drafts.push({ field, value: v, kind: "confirmation" });
  }
  return drafts;
}

/** "Undo my edits": every field the person had changed goes back to the prediction, and that is recorded. */
export function draftsFromReset(predicted: FieldValues, prior: Partial<Record<LabelField, unknown>>): LabelDraft[] {
  const drafts: LabelDraft[] = [];
  if (prior.is_recruiting === false) drafts.push({ field: "is_recruiting", value: true, kind: "revert" });
  for (const field of FIELDS) {
    const p = encodeField(field, predicted);
    if (prior[field] !== undefined && !same(prior[field], p)) drafts.push({ field, value: p, kind: "revert" });
  }
  return drafts;
}

/** Labels for a correction recorded before label logging existed. Provenance is legacy: the prediction cannot be proven. */
export function draftsFromLegacyCorrection(c: EventCorrection): LabelDraft[] {
  if (c.ignored) return [{ field: "is_recruiting", value: false, kind: "correction" }];
  const out: LabelDraft[] = [];
  if (c.type !== undefined) out.push({ field: "type", value: c.type, kind: "correction" });
  if (c.company !== undefined) out.push({ field: "company", value: c.company, kind: "correction" });
  if (c.role !== undefined) out.push({ field: "role", value: c.role ?? NOT_APPLICABLE, kind: "correction" });
  if (c.eventDate !== undefined) out.push({ field: "event_date", value: c.eventDate ? c.eventDate.toISOString() : NOT_APPLICABLE, kind: "correction" });
  return out;
}
