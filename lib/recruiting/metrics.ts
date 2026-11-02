import { correctedFields } from "./corrections.ts";
import { parseCorrection } from "./corrections.ts";

export type ValidationInput = {
  events: Array<{ user: string; correction: unknown }>;
  usage: Array<{ user: string; kind: string; at: Date }>;
  syncs: Array<{ userGoogleSub: string; lastSyncedAt: Date; messagesScanned: number; eventsExtracted: number }>;
  connections: Array<{ user: string; connectedAt: Date }>;
};

export type TesterMetrics = {
  label: string;
  connectedAt: Date;
  messagesScanned: number;
  eventsExtracted: number;
  eventsCorrected: number;
  correctionRate: number;
  correctionsByField: Record<string, number>;
  todayViews: number;
  activeDays: number;
  /** Days with a Today view that were >=1 day after connecting — "came back unprompted". */
  returnDays: number;
  actionsDismissed: number;
  lastSeen: Date | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** One row per tester, anonymised as "Tester N" (ordered by connect time). */
export function computeValidationMetrics(input: ValidationInput): TesterMetrics[] {
  const connections = [...input.connections].sort((a, b) => a.connectedAt.getTime() - b.connectedAt.getTime());
  return connections.map((conn, i) => {
    const events = input.events.filter((e) => e.user === conn.user);
    const sync = input.syncs.find((s) => s.userGoogleSub === conn.user);
    const usage = input.usage.filter((u) => u.user === conn.user);
    const byField: Record<string, number> = {};
    let corrected = 0;
    for (const e of events) {
      const fields = correctedFields(parseCorrection(e.correction));
      if (fields.length > 0) corrected += 1;
      for (const f of fields) byField[f] = (byField[f] ?? 0) + 1;
    }
    const todayDays = new Set(usage.filter((u) => u.kind === "view_today").map((u) => day(u.at)));
    const connectDay = day(conn.connectedAt);
    return {
      label: `Tester ${i + 1}`,
      connectedAt: conn.connectedAt,
      messagesScanned: sync?.messagesScanned ?? 0,
      eventsExtracted: events.length,
      eventsCorrected: corrected,
      correctionRate: events.length === 0 ? 0 : corrected / events.length,
      correctionsByField: byField,
      todayViews: usage.filter((u) => u.kind === "view_today").length,
      activeDays: new Set(usage.map((u) => day(u.at))).size,
      returnDays: [...todayDays].filter((d) => d > connectDay).length,
      actionsDismissed: usage.filter((u) => u.kind === "dismiss_action").length,
      lastSeen: usage.length > 0 ? usage.reduce((a, b) => (a.at > b.at ? a : b)).at : null,
    };
  });
}
