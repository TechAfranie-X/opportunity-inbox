import type { EffectiveEvent } from "../recruiting/types.ts";

/** Days a later message cancelled ("Canceled event: ..." records `cancelled:YYYY-MM-DD`): a scheduled interview on such a day no longer exists. */
export function cancelledDays(events: EffectiveEvent[]): Set<string> {
  return new Set(events.flatMap((e) => e.signals.filter((s) => /^cancelled:\d{4}-\d{2}-\d{2}$/.test(s)).map((s) => s.slice(10))));
}
export function isCancelledSchedule(e: EffectiveEvent, days: Set<string>): boolean {
  return !!e.eventDate && days.has(e.eventDate.toISOString().slice(0, 10)) && (e.type === "interview_scheduled" || e.type === "interview_invite");
}
