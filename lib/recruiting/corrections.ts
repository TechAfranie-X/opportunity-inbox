import { EVENT_TYPES, type EventType } from "./types.ts";
import type { EventCorrection } from "./opportunity.ts";

/** Validate the jsonb blob we read back from Postgres before trusting it. */
export function parseCorrection(raw: unknown): EventCorrection | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: EventCorrection = {};
  if (r.ignored === true) out.ignored = true;
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
