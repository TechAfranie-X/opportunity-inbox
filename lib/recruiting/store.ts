import "server-only";

import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
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
import {
  draftsFromConfirmation,
  draftsFromEdit,
  draftsFromIgnore,
  draftsFromReset,
  parseCorrection,
  serializeCorrection,
  type FieldValues,
  type LabelDraft,
} from "@/lib/recruiting/corrections";
import { resolveLabels } from "@/lib/recruiting/evaluator";
import { parsePolicy } from "@/lib/recruiting/policy";
import {
  applyCorrection,
  buildOpportunities,
  type EventCorrection,
  type OpportunityOverride,
} from "@/lib/recruiting/opportunity";
import type { Prediction } from "@/lib/recruiting/predictions";
import { inheritRoles, type ThreadAnchor } from "@/lib/recruiting/extract";
import { EXTRACTOR_VERSION } from "@/lib/recruiting/version";
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

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const predictedValues = (row: EventRow): FieldValues => ({ type: row.type as EventType, company: row.company, role: row.role, eventDate: row.eventDate });

/**
 * Append the person's explicit statements as labels, against the prediction they were looking at.
 * Never edits an earlier label or prediction: a changed mind is a new row.
 */
async function appendUserLabels(tx: Tx, userGoogleSub: string, row: EventRow, drafts: LabelDraft[]) {
  if (drafts.length === 0) return;
  const [shown] = await tx
    .select({ id: eventPredictions.id })
    .from(eventPredictions)
    .where(and(eq(eventPredictions.userGoogleSub, userGoogleSub), eq(eventPredictions.gmailMessageId, row.gmailMessageId)))
    .orderBy(desc(eventPredictions.predictedAt))
    .limit(1);
  await tx.insert(labels).values(
    drafts.map((d) => ({ userGoogleSub, gmailMessageId: row.gmailMessageId, field: d.field, value: d.value as never, source: "user_correction" as const, labeler: "user", predictionId: shown?.id ?? null })),
  );
}

/** The person's own latest label per field for this message, so the next statement can be compared with it. */
async function priorUserLabels(tx: Tx, userGoogleSub: string, gmailMessageId: string) {
  const rows = await tx
    .select()
    .from(labels)
    .where(and(eq(labels.userGoogleSub, userGoogleSub), eq(labels.gmailMessageId, gmailMessageId), eq(labels.source, "user_correction")))
    .orderBy(asc(labels.createdAt));
  const resolved = resolveLabels(rows.map((r) => ({ gmailMessageId: r.gmailMessageId, field: r.field as never, value: r.value, source: "user_correction" as const, createdAt: r.createdAt })), ["user_correction"]);
  return resolved.get(gmailMessageId) ?? {};
}

async function loadRow(tx: Tx | Db, userGoogleSub: string, eventId: string) {
  const [row] = await tx.select().from(recruitingEvents).where(and(eq(recruitingEvents.id, eventId), eq(recruitingEvents.userGoogleSub, userGoogleSub))).limit(1);
  return row;
}

/** Record only the fields that differ from what we extracted; matching fields stay un-overridden. The same statements are logged as labels. */
export async function editEvent(userGoogleSub: string, eventId: string, edit: EventEdit) {
  await getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userGoogleSub, eventId);
    if (!row) return;
    const correction: EventCorrection = {};
    if (edit.type !== row.type) correction.type = edit.type;
    if (edit.company && edit.company !== row.company) correction.company = edit.company;
    if (edit.role !== row.role) correction.role = edit.role;
    const before = row.eventDate?.getTime() ?? null;
    const after = edit.eventDate?.getTime() ?? null;
    if (before !== after) correction.eventDate = edit.eventDate;

    const prior = await priorUserLabels(tx, userGoogleSub, row.gmailMessageId);
    const effective: FieldValues = { type: edit.type, company: edit.company || row.company, role: edit.role, eventDate: edit.eventDate };
    await appendUserLabels(tx, userGoogleSub, row, draftsFromEdit(predictedValues(row), effective, prior));
    await tx.update(recruitingEvents).set({ correction: Object.keys(correction).length > 0 ? serializeCorrection(correction) : null }).where(eq(recruitingEvents.id, eventId));
  });
}

export async function ignoreEvent(userGoogleSub: string, eventId: string) {
  await getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userGoogleSub, eventId);
    if (!row) return;
    await appendUserLabels(tx, userGoogleSub, row, draftsFromIgnore(await priorUserLabels(tx, userGoogleSub, row.gmailMessageId)));
    await tx.update(recruitingEvents).set({ correction: serializeCorrection({ ignored: true }) }).where(eq(recruitingEvents.id, eventId));
  });
}

/** "Looks right": an explicit confirmation of what is shown. Changes nothing the person sees. */
export async function confirmEvent(userGoogleSub: string, eventId: string) {
  await getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userGoogleSub, eventId);
    if (!row) return;
    const correction = parseCorrection(row.correction);
    const shown: FieldValues = {
      type: correction?.type ?? (row.type as EventType),
      company: correction?.company ?? row.company,
      role: correction?.role !== undefined ? correction.role : row.role,
      eventDate: correction?.eventDate !== undefined ? correction.eventDate : row.eventDate,
    };
    await appendUserLabels(tx, userGoogleSub, row, draftsFromConfirmation(shown, await priorUserLabels(tx, userGoogleSub, row.gmailMessageId)));
  });
}

/** "Undo my edits": back to the prediction, recorded as such. */
export async function resetEvent(userGoogleSub: string, eventId: string) {
  await getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userGoogleSub, eventId);
    if (!row) return;
    await appendUserLabels(tx, userGoogleSub, row, draftsFromReset(predictedValues(row), await priorUserLabels(tx, userGoogleSub, row.gmailMessageId)));
    await tx.update(recruitingEvents).set({ correction: null }).where(eq(recruitingEvents.id, eventId));
  });
}

/** Which of these messages the CURRENT extractor has already evaluated (recruiting or not): they need no second read. */
export async function evaluatedMessageIds(userGoogleSub: string, ids: string[], extractorVersion = EXTRACTOR_VERSION): Promise<Set<string>> {
  const found = new Set<string>();
  const db = getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: eventPredictions.gmailMessageId })
      .from(eventPredictions)
      .where(and(eq(eventPredictions.userGoogleSub, userGoogleSub), eq(eventPredictions.extractorVersion, extractorVersion), inArray(eventPredictions.gmailMessageId, ids.slice(i, i + 500))));
    for (const r of rows) found.add(r.id);
  }
  return found;
}

/** One anchor per thread with activity in the last `days`: the earliest inbound event, preferring one that names a company. */
export async function recentThreadAnchors(userGoogleSub: string, days: number, now = new Date()): Promise<ThreadAnchor[]> {
  const db = getDb();
  const since = new Date(now.getTime() - days * 86_400_000);
  const recent = await db.select({ t: recruitingEvents.gmailThreadId }).from(recruitingEvents).where(and(eq(recruitingEvents.userGoogleSub, userGoogleSub), gte(recruitingEvents.occurredAt, since)));
  const threads = [...new Set(recent.map((r) => r.t))];
  const anchors = new Map<string, ThreadAnchor>();
  for (let i = 0; i < threads.length; i += 500) {
    const rows = await db
      .select({ t: recruitingEvents.gmailThreadId, company: recruitingEvents.company, role: recruitingEvents.role, confidence: recruitingEvents.confidence, fieldConfidence: recruitingEvents.fieldConfidence })
      .from(recruitingEvents)
      .where(and(eq(recruitingEvents.userGoogleSub, userGoogleSub), inArray(recruitingEvents.gmailThreadId, threads.slice(i, i + 500)), eq(recruitingEvents.outbound, false)))
      .orderBy(asc(recruitingEvents.occurredAt));
    for (const r of rows) {
      const current = anchors.get(r.t);
      if (!current || (!current.company && r.company)) anchors.set(r.t, { gmailThreadId: r.t, company: r.company, role: r.role, confidence: r.confidence, fieldConfidence: r.fieldConfidence ?? undefined });
    }
  }
  return [...anchors.values()];
}

export async function countEvents(userGoogleSub: string): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, userGoogleSub));
  return Number(row?.n ?? 0);
}

/**
 * Apply the extractor's role-inheritance rule across every stored event of this user. A single full extraction does this over the
 * whole batch; a sync split into chunks (or run incrementally) must do it over what is stored, or events in different chunks
 * would lose roles they would have inherited. Idempotent: it only fills roles that are empty.
 */
export async function inheritStoredRoles(userGoogleSub: string): Promise<number> {
  const db = getDb();
  const rows = await db.select().from(recruitingEvents).where(eq(recruitingEvents.userGoogleSub, userGoogleSub));
  const events = rows.map(rowToExtracted);
  const before = new Map(events.map((e) => [e.id, e.role]));
  inheritRoles(events);
  let changed = 0;
  for (const e of events) {
    if (e.role === before.get(e.id)) continue;
    await db.update(recruitingEvents).set({ role: e.role, fieldConfidence: e.fieldConfidence ?? null, signals: e.signals }).where(and(eq(recruitingEvents.id, e.id), eq(recruitingEvents.userGoogleSub, userGoogleSub)));
    changed += 1;
  }
  return changed;
}
