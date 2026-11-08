import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { shadowReads } from "@/lib/db/schema";
import { READER_VERSION_V3 } from "@/lib/recruiting/reader/guide3";
import type { ReportRow } from "./report";
import { reviewItemOf, type ReviewItem, type ShadowRecord } from "./shadow";

type Row = typeof shadowReads.$inferSelect;

/** Row -> record. The database has no extra business fields; id and timestamps are the only difference. */
const toRecord = (r: Row): ShadowRecord => ({
  userGoogleSub: r.userGoogleSub, gmailMessageId: r.gmailMessageId, gmailThreadId: r.gmailThreadId, readerVersion: r.readerVersion,
  pipelineVersion: r.pipelineVersion, extractorVersion: r.extractorVersion, arrivedAt: r.arrivedAt, senderDomain: r.senderDomain,
  cohort: r.cohort as ShadowRecord["cohort"], uniformArm: r.uniformArm, isCandidate: r.isCandidate, legacyQueryMatch: r.legacyQueryMatch, plannedRead: r.plannedRead,
  planReason: r.planReason as ShadowRecord["planReason"], rulesRecruiting: r.rulesRecruiting, rulesType: r.rulesType as ShadowRecord["rulesType"],
  rulesCompany: r.rulesCompany, rulesRole: r.rulesRole, modelStatus: r.modelStatus, modelRecruiting: r.modelRecruiting, modelType: r.modelType,
  modelStage: r.modelStage, modelCompany: r.modelCompany, modelRole: r.modelRole, modelCertainty: r.modelCertainty,
  modelEvidenceHash: r.modelEvidenceHash, modelRejections: r.modelRejections, modelReadAt: r.modelReadAt,
  state: r.state as ShadowRecord["state"], reviewReason: r.reviewReason as ShadowRecord["reviewReason"],
  modelSuggests: r.modelSuggests as ShadowRecord["modelSuggests"], typeReview: r.typeReview, companyReview: r.companyReview,
  roleReview: r.roleReview, finalType: r.finalType, finalCompany: r.finalCompany, finalRole: r.finalRole,
});

export async function knownMessageIds(userSub: string): Promise<Set<string>> {
  const rows = await getDb().select({ id: shadowReads.gmailMessageId }).from(shadowReads).where(and(eq(shadowReads.userGoogleSub, userSub), eq(shadowReads.readerVersion, READER_VERSION_V3)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Ingestion is write-once: cohort, arm, routing and the rules reading are fixed at the first sighting and a later sync
 * can never change them (ON CONFLICT DO NOTHING). Only the model read and the resolution are updated afterwards.
 */
export async function insertShadowReads(records: ShadowRecord[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < records.length; i += 200) {
    const res = await getDb().insert(shadowReads).values(records.slice(i, i + 200)).onConflictDoNothing().returning({ id: shadowReads.id });
    n += res.length;
  }
  return n;
}

export async function pendingModelReads(userSub: string, limit = 300): Promise<ShadowRecord[]> {
  const rows = await getDb().select().from(shadowReads)
    .where(and(eq(shadowReads.userGoogleSub, userSub), eq(shadowReads.readerVersion, READER_VERSION_V3), eq(shadowReads.plannedRead, true), isNull(shadowReads.modelStatus)))
    .limit(limit);
  return rows.map(toRecord);
}

export async function getShadowRecord(userSub: string, messageId: string): Promise<ShadowRecord | null> {
  const [row] = await getDb().select().from(shadowReads).where(and(eq(shadowReads.userGoogleSub, userSub), eq(shadowReads.gmailMessageId, messageId), eq(shadowReads.readerVersion, READER_VERSION_V3))).limit(1);
  return row ? toRecord(row) : null;
}

/**
 * Writes the model read and the resolution derived from it. Ingestion fields are not part of this update.
 * First read wins: a row that already has a model read is never overwritten, so a re-import, a retry or a later
 * "better" output cannot change what the system said about a message (needed for a prospective evaluation).
 * Returns whether this call wrote the read.
 */
export async function saveResolution(rec: ShadowRecord): Promise<boolean> {
  const res = await getDb().update(shadowReads).set({
    modelStatus: rec.modelStatus, modelRecruiting: rec.modelRecruiting, modelType: rec.modelType, modelStage: rec.modelStage, modelCompany: rec.modelCompany,
    modelRole: rec.modelRole, modelCertainty: rec.modelCertainty, modelEvidenceHash: rec.modelEvidenceHash, modelRejections: rec.modelRejections, modelReadAt: rec.modelReadAt,
    state: rec.state, reviewReason: rec.reviewReason, modelSuggests: rec.modelSuggests, typeReview: rec.typeReview, companyReview: rec.companyReview,
    roleReview: rec.roleReview, finalType: rec.finalType, finalCompany: rec.finalCompany, finalRole: rec.finalRole, updatedAt: new Date(),
  }).where(and(eq(shadowReads.userGoogleSub, rec.userGoogleSub), eq(shadowReads.gmailMessageId, rec.gmailMessageId), eq(shadowReads.readerVersion, rec.readerVersion), isNull(shadowReads.modelStatus))).returning({ id: shadowReads.id });
  return res.length === 1;
}

export async function reportRows(userSub: string | null): Promise<Array<ReportRow & { userGoogleSub: string }>> {
  const where = userSub ? and(eq(shadowReads.readerVersion, READER_VERSION_V3), eq(shadowReads.userGoogleSub, userSub)) : eq(shadowReads.readerVersion, READER_VERSION_V3);
  return (await getDb().select().from(shadowReads).where(where)).map((r) => ({ ...toRecord(r), userGoogleSub: r.userGoogleSub }));
}

export async function reviewItems(userSub: string, actionableOnly = true): Promise<ReviewItem[]> {
  const rows = await getDb().select().from(shadowReads).where(and(eq(shadowReads.userGoogleSub, userSub), eq(shadowReads.readerVersion, READER_VERSION_V3), eq(shadowReads.state, "review")));
  return rows.map((r) => reviewItemOf(toRecord(r))).filter((x): x is ReviewItem => !!x && (!actionableOnly || x.actionable));
}
