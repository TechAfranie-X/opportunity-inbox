import "server-only";

import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  actionDismissals,
  eventPredictions,
  gmailConnections,
  labels,
  opportunityOverrides,
  recruitingEvents,
  recruitingSync,
  usageEvents,
} from "@/lib/db/schema";
import { buildActions, toFloating } from "@/lib/recruiting/actions";
import { parseCorrection, serializeCorrection } from "@/lib/recruiting/corrections";
import { parsePolicy } from "@/lib/recruiting/policy";
import {
  applyCorrection,
  buildOpportunities,
  type EventCorrection,
  type OpportunityOverride,
} from "@/lib/recruiting/opportunity";
import type { Prediction } from "@/lib/recruiting/predictions";
import type {
  ActionItem,
  EffectiveEvent,
  EventType,
  ExtractedEvent,
  Opportunity,
} from "@/lib/recruiting/types";

type EventRow = typeof recruitingEvents.$inferSelect;

function rowToExtracted(row: EventRow): ExtractedEvent & { id: string } {
  return {
    id: row.id,
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    occurredAt: row.occurredAt,
    outbound: row.outbound,
    senderName: row.senderName,
    senderDomain: row.senderDomain,
    subject: row.subject,
    type: row.type as EventType,
    company: row.company,
    role: row.role,
    eventDate: row.eventDate,
    eventDateHasTime: row.eventDateHasTime,
    dateKind: (row.dateKind as ExtractedEvent["dateKind"]) ?? null,
    confidence: row.confidence,
    fieldConfidence: row.fieldConfidence ?? undefined,
    reviewReasons: row.reviewReasons ?? undefined,
    signals: row.signals,
  };
}

export type Workspace = {
  opportunities: Opportunity[];
  actions: ActionItem[];
  lastSyncedAt: Date | null;
  eventCount: number;
};

export async function loadWorkspace(userGoogleSub: string, now = new Date()): Promise<Workspace> {
  const db = getDb();
  const [rows, overrideRows, dismissalRows, syncRows] = await Promise.all([
    db.select().from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, userGoogleSub)),
    db.select().from(opportunityOverrides).where(eq(opportunityOverrides.userGoogleSub, userGoogleSub)),
    db.select().from(actionDismissals).where(eq(actionDismissals.userGoogleSub, userGoogleSub)),
    db.select().from(recruitingSync).where(eq(recruitingSync.userGoogleSub, userGoogleSub)).limit(1),
  ]);

  const events: EffectiveEvent[] = rows.flatMap((row) => {
    const effective = applyCorrection(rowToExtracted(row), parseCorrection(row.correction));
    return effective ? [effective] : [];
  });
  const overrides = new Map<string, OpportunityOverride>(
    overrideRows.flatMap((o) =>
      o.status === "closed" || o.status === "active"
        ? [[o.opportunityKey, { status: o.status } as OpportunityOverride] as const]
        : [],
    ),
  );
  // Thresholds are configuration (OPPORTUNITY_POLICY, JSON), not code: they are chosen from measured risk-coverage, not by hand.
  const policy = parsePolicy(process.env.OPPORTUNITY_POLICY);
  const opportunities = buildOpportunities(events, overrides, policy);
  const actions = buildActions(opportunities, toFloating(now), new Set(dismissalRows.map((d) => d.actionId)), policy);

  return { opportunities, actions, lastSyncedAt: syncRows[0]?.lastSyncedAt ?? null, eventCount: events.length };
}

/** Upsert freshly extracted fields. Never touches `correction`, so user edits survive re-sync. */
export async function saveExtractedEvents(userGoogleSub: string, events: ExtractedEvent[]) {
  if (events.length === 0) return;
  const db = getDb();
  for (let i = 0; i < events.length; i += 100) {
    await db
      .insert(recruitingEvents)
      .values(events.slice(i, i + 100).map((e) => ({ userGoogleSub, ...e })))
      .onConflictDoUpdate({
        target: [recruitingEvents.userGoogleSub, recruitingEvents.gmailMessageId],
        set: {
          type: sql`excluded.type`,
          company: sql`excluded.company`,
          role: sql`excluded.role`,
          eventDate: sql`excluded.event_date`,
          eventDateHasTime: sql`excluded.event_date_has_time`,
          dateKind: sql`excluded.date_kind`,
          confidence: sql`excluded.confidence`,
          signals: sql`excluded.signals`,
          fieldConfidence: sql`excluded.field_confidence`,
          reviewReasons: sql`excluded.review_reasons`,
        },
      });
  }
}

/**
 * Append what the extractor concluded, per extractor version. Never updates: re-running the same version is a
 * no-op, and a new version adds new rows, so the history of predictions survives every re-sync.
 */
export async function savePredictions(userGoogleSub: string, predictions: Prediction[]) {
  if (predictions.length === 0) return 0;
  const db = getDb();
  let inserted = 0;
  for (let i = 0; i < predictions.length; i += 200) {
    const rows = await db
      .insert(eventPredictions)
      .values(predictions.slice(i, i + 200).map((p) => ({ userGoogleSub, ...p })))
      .onConflictDoNothing()
      .returning({ id: eventPredictions.id });
    inserted += rows.length;
  }
  return inserted;
}

/**
 * After a re-sync, drop events for emails we just re-evaluated and no longer consider recruiting
 * (e.g. the extractor got better at rejecting promotions). Events outside this scan, and any
 * the user has corrected, are never touched.
 */
export async function pruneReclassified(userGoogleSub: string, scannedMessageIds: string[], keptMessageIds: string[]) {
  const dropped = scannedMessageIds.filter((id) => !new Set(keptMessageIds).has(id));
  if (dropped.length === 0) return 0;
  const db = getDb();
  let removed = 0;
  for (let i = 0; i < dropped.length; i += 200) {
    const rows = await db
      .delete(recruitingEvents)
      .where(
        and(
          eq(recruitingEvents.userGoogleSub, userGoogleSub),
          inArray(recruitingEvents.gmailMessageId, dropped.slice(i, i + 200)),
          isNull(recruitingEvents.correction),
        ),
      )
      .returning({ id: recruitingEvents.id });
    removed += rows.length;
  }
  return removed;
}

export async function markSynced(userGoogleSub: string, scanned: number, extracted: number) {
  const values = { userGoogleSub, lastSyncedAt: new Date(), messagesScanned: scanned, eventsExtracted: extracted };
  await getDb()
    .insert(recruitingSync)
    .values(values)
    .onConflictDoUpdate({ target: recruitingSync.userGoogleSub, set: values });
}

export async function getLastSyncedAt(userGoogleSub: string) {
  const [row] = await getDb().select().from(recruitingSync).where(eq(recruitingSync.userGoogleSub, userGoogleSub)).limit(1);
  return row?.lastSyncedAt ?? null;
}

export async function setEventCorrection(userGoogleSub: string, eventId: string, correction: EventCorrection | null) {
  await getDb()
    .update(recruitingEvents)
    .set({ correction: correction ? serializeCorrection(correction) : null })
    .where(and(eq(recruitingEvents.id, eventId), eq(recruitingEvents.userGoogleSub, userGoogleSub)));
}

export async function getEventCorrection(userGoogleSub: string, eventId: string) {
  const [row] = await getDb()
    .select({ correction: recruitingEvents.correction })
    .from(recruitingEvents)
    .where(and(eq(recruitingEvents.id, eventId), eq(recruitingEvents.userGoogleSub, userGoogleSub)))
    .limit(1);
  return parseCorrection(row?.correction);
}

export async function setOpportunityStatus(userGoogleSub: string, key: string, status: "closed" | "active" | null) {
  const db = getDb();
  if (status === null) {
    await db.delete(opportunityOverrides).where(and(eq(opportunityOverrides.userGoogleSub, userGoogleSub), eq(opportunityOverrides.opportunityKey, key)));
    return;
  }
  await db
    .insert(opportunityOverrides)
    .values({ userGoogleSub, opportunityKey: key, status })
    .onConflictDoUpdate({
      target: [opportunityOverrides.userGoogleSub, opportunityOverrides.opportunityKey],
      set: { status, updatedAt: new Date() },
    });
}

export async function dismissAction(userGoogleSub: string, actionId: string) {
  await getDb().insert(actionDismissals).values({ userGoogleSub, actionId }).onConflictDoNothing();
}

export async function recordUsage(userGoogleSub: string, kind: string) {
  try {
    await getDb().insert(usageEvents).values({ userGoogleSub, kind });
  } catch {
    // Telemetry must never break the product.
  }
}

/** Delete everything we derived from the user's mail (privacy control). Keeps the Gmail connection. */
export async function deleteRecruitingData(userGoogleSub: string) {
  const db = getDb();
  await db.delete(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, userGoogleSub));
  // Everything derived from this mailbox, including predictions (and the user's own corrections), goes with it.
  await db.delete(labels).where(eq(labels.userGoogleSub, userGoogleSub));
  await db.delete(eventPredictions).where(eq(eventPredictions.userGoogleSub, userGoogleSub));
  await db.delete(opportunityOverrides).where(eq(opportunityOverrides.userGoogleSub, userGoogleSub));
  await db.delete(actionDismissals).where(eq(actionDismissals.userGoogleSub, userGoogleSub));
  await db.delete(recruitingSync).where(eq(recruitingSync.userGoogleSub, userGoogleSub));
}

export async function disconnectGmail(userGoogleSub: string) {
  await deleteRecruitingData(userGoogleSub);
  await getDb().delete(gmailConnections).where(eq(gmailConnections.userGoogleSub, userGoogleSub));
}

/** Aggregated, content-free validation metrics for the operator. */
export async function loadValidationRows() {
  const db = getDb();
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [events, usage, syncs, connections] = await Promise.all([
    db.select({ user: recruitingEvents.userGoogleSub, correction: recruitingEvents.correction }).from(recruitingEvents),
    db.select({ user: usageEvents.userGoogleSub, kind: usageEvents.kind, at: usageEvents.at }).from(usageEvents).where(gte(usageEvents.at, since)).orderBy(desc(usageEvents.at)),
    db.select().from(recruitingSync),
    db.select({ user: gmailConnections.userGoogleSub, connectedAt: gmailConnections.connectedAt }).from(gmailConnections),
  ]);
  return { events, usage, syncs, connections };
}


export type EventEdit = {
  type: EventType;
  company: string;
  role: string | null;
  eventDate: Date | null;
};

/** Record only the fields that differ from what we extracted; matching fields stay un-overridden. */
export async function editEvent(userGoogleSub: string, eventId: string, edit: EventEdit) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(recruitingEvents)
    .where(and(eq(recruitingEvents.id, eventId), eq(recruitingEvents.userGoogleSub, userGoogleSub)))
    .limit(1);
  if (!row) return;

  const correction: EventCorrection = {};
  if (edit.type !== row.type) correction.type = edit.type;
  if (edit.company && edit.company !== row.company) correction.company = edit.company;
  if (edit.role !== row.role) correction.role = edit.role;
  const before = row.eventDate?.getTime() ?? null;
  const after = edit.eventDate?.getTime() ?? null;
  if (before !== after) correction.eventDate = edit.eventDate;

  await setEventCorrection(userGoogleSub, eventId, Object.keys(correction).length > 0 ? correction : null);
}

export async function ignoreEvent(userGoogleSub: string, eventId: string) {
  await setEventCorrection(userGoogleSub, eventId, { ignored: true });
}
