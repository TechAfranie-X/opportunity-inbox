import { createHash } from "node:crypto";
import { parseSender } from "../../opportunities/normalize.ts";
import { buildPredictions } from "../predictions.ts";
import { planRead, settle, type ReadPlan } from "../reader/pipeline.ts";
import { READER_VERSION_V3 } from "../reader/guide3.ts";
import type { Reading } from "../reader/reconcile.ts";
import { toReaderType } from "../reader/taxonomy.ts";
import type { ReaderType, VerifiedOutput } from "../reader/types.ts";
import type { RecruitingEmail } from "../types.ts";
import { EXTRACTOR_VERSION } from "../version.ts";
import { readShadowConfig, type ShadowConfig } from "./config.ts";
import { FROZEN } from "./frozen.ts";

export { readShadowConfig, type ShadowConfig };

/**
 * Architecture v2 in SHADOW mode: the pipeline runs beside the product and records what it would decide, without
 * changing or exposing anything the user sees. This module is pure (no database, no Gmail) so every rule is testable.
 *
 * Privacy contract: a ShadowRecord has no field for message text, subject or quotes. Structured values (company, role,
 * type) are the same kind the product already stores in recruiting_events.
 */
export const PIPELINE_VERSION: string = FROZEN.pipelineVersion;

/**
 * Deterministic uniform-sample membership, fixed by a hash of (user, message) alone. It cannot depend on content or on
 * anything the system predicted, which is what lets a later evaluation treat the arm as a random sample.
 */
export function uniformArm(userSub: string, messageId: string, rate: number): boolean {
  const h = createHash("sha256").update(`${userSub}|${messageId}|uniform-arm-v1`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000 < rate;
}

export const cohortOf = (arrivedAt: Date, cutoff: Date): "historical" | "prospective" =>
  arrivedAt.getTime() >= cutoff.getTime() ? "prospective" : "historical";

export type PlanReason = ReadPlan["reason"] | "not_candidate";
export type ReviewReason = "reader_disagreement" | "model_abstained" | "pending_model";

/** Mirrors the shadow_reads columns, minus id and timestamps. */
export type ShadowRecord = {
  userGoogleSub: string;
  gmailMessageId: string;
  gmailThreadId: string;
  readerVersion: string;
  pipelineVersion: string;
  extractorVersion: string;
  arrivedAt: Date;
  senderDomain: string;
  cohort: "historical" | "prospective";
  uniformArm: boolean;
  isCandidate: boolean;
  /** Would the current product's keyword query have fetched it? Null: not recorded. */
  legacyQueryMatch: boolean | null;
  plannedRead: boolean;
  planReason: PlanReason;
  rulesRecruiting: boolean;
  rulesType: ReaderType | null;
  rulesCompany: string | null;
  rulesRole: string | null;
  modelStatus: string | null;
  modelRecruiting: boolean | null;
  modelType: string | null;
  modelStage: string | null;
  modelCompany: string | null;
  modelRole: string | null;
  modelCertainty: string | null;
  modelEvidenceHash: string | null;
  modelRejections: string[] | null;
  /** Structured values the independent grounding audit could not trace to the model input, counted at import. Null: not read. */
  modelUngrounded: number | null;
  modelReadAt: Date | null;
  state: "recruiting" | "not_recruiting" | "review";
  reviewReason: ReviewReason | null;
  modelSuggests: "recruiting" | "not_recruiting" | null;
  typeReview: boolean;
  companyReview: boolean;
  roleReview: boolean;
  finalType: string | null;
  finalCompany: string | null;
  finalRole: string | null;
};

const base = (userSub: string, id: string, threadId: string, from: string, arrivedAt: Date, cfg: ShadowConfig) => ({
  userGoogleSub: userSub,
  gmailMessageId: id,
  gmailThreadId: threadId,
  readerVersion: READER_VERSION_V3,
  pipelineVersion: PIPELINE_VERSION,
  extractorVersion: EXTRACTOR_VERSION,
  arrivedAt,
  senderDomain: parseSender(from).domain,
  cohort: cohortOf(arrivedAt, cfg.cutoff),
  uniformArm: uniformArm(userSub, id, cfg.uniformRate),
});

const EMPTY_MODEL = { modelStatus: null, modelRecruiting: null, modelType: null, modelStage: null, modelCompany: null, modelRole: null, modelCertainty: null, modelEvidenceHash: null, modelRejections: null, modelUngrounded: null, modelReadAt: null };
const EMPTY_RESOLUTION = { reviewReason: null, modelSuggests: null, typeReview: false, companyReview: false, roleReview: false, finalType: null, finalCompany: null, finalRole: null };

/** The frozen rules' reading of one message, in the reader taxonomy. */
export function rulesReadingOf(email: RecruitingEmail): Reading {
  const p = buildPredictions([email]).find((x) => x.gmailMessageId === email.id);
  return { recruiting: p?.decision === "recruiting", type: toReaderType(p?.type ?? null), company: p?.company ?? null, role: p?.role ?? null };
}

/** A candidate message just fetched: routing and the rules' reading are fixed now; the model read comes later. */
export function recordForCandidate(userSub: string, email: RecruitingEmail, cfg: ShadowConfig, legacyQueryMatch: boolean | null, rules: Reading = rulesReadingOf(email)): ShadowRecord {
  const plan = planRead(email);
  const rec: ShadowRecord = {
    ...base(userSub, email.id, email.threadId, email.from, email.receivedAt, cfg),
    isCandidate: true,
    legacyQueryMatch,
    plannedRead: plan.read,
    planReason: plan.reason,
    rulesRecruiting: rules.recruiting,
    rulesType: rules.type,
    rulesCompany: rules.company,
    rulesRole: rules.role,
    ...EMPTY_MODEL,
    state: "not_recruiting",
    ...EMPTY_RESOLUTION,
  };
  return resolveRecord(rec, null);
}

/** A uniform-arm message the candidate query did NOT match (metadata only; the rules never saw it). Measures candidate recall later. */
export function recordForNonCandidate(userSub: string, meta: { id: string; threadId: string; from: string; receivedAt: Date }, cfg: ShadowConfig): ShadowRecord {
  return {
    ...base(userSub, meta.id, meta.threadId, meta.from, meta.receivedAt, cfg),
    isCandidate: false,
    legacyQueryMatch: false,
    plannedRead: false,
    planReason: "not_candidate",
    rulesRecruiting: false,
    rulesType: null,
    rulesCompany: null,
    rulesRole: null,
    ...EMPTY_MODEL,
    state: "not_recruiting",
    ...EMPTY_RESOLUTION,
  };
}


/**
 * A message the CURRENT product's keyword query fetches but the v2 candidate set does not contain (for example keyword mail
 * that Gmail files under Promotions). v2 does not read it; it is recorded, with the rules' reading the product would have
 * produced, so the report can count what v2 would stop showing. The product already fetches exactly these messages today.
 */
export function recordForLegacyOnly(userSub: string, email: RecruitingEmail, cfg: ShadowConfig, rules: Reading = rulesReadingOf(email)): ShadowRecord {
  return {
    ...base(userSub, email.id, email.threadId, email.from, email.receivedAt, cfg),
    isCandidate: false,
    legacyQueryMatch: true,
    plannedRead: false,
    planReason: "not_candidate",
    rulesRecruiting: rules.recruiting,
    rulesType: rules.type,
    rulesCompany: rules.company,
    rulesRole: rules.role,
    ...EMPTY_MODEL,
    state: "not_recruiting",
    ...EMPTY_RESOLUTION,
  };
}

export const rulesOf = (rec: ShadowRecord): Reading => ({ recruiting: rec.rulesRecruiting, type: rec.rulesType, company: rec.rulesCompany, role: rec.rulesRole });

/**
 * Re-resolves a record from its stored routing, its stored rules reading and a (possibly missing) verified model output.
 * Pure, so importing a worker output never needs the message again.
 */
export function resolveRecord(rec: ShadowRecord, model: VerifiedOutput | null, readAt: Date | null = null, ungrounded: number | null = null): ShadowRecord {
  const plan: ReadPlan = { read: rec.plannedRead, reason: rec.planReason === "not_candidate" ? "unclassified" : rec.planReason };
  const r = settle(plan, rulesOf(rec), model);
  const reviewReason: ReviewReason | null = r.state !== "review" ? null : !model ? "pending_model" : r.reason === "model_abstained" ? "model_abstained" : "reader_disagreement";
  return {
    ...rec,
    modelStatus: model?.status ?? null,
    modelRecruiting: model ? model.recruiting : null,
    modelType: model?.type ?? null,
    modelStage: model?.stage ?? null,
    modelCompany: model?.company ?? null,
    modelRole: model?.role ?? null,
    modelCertainty: model?.certainty ?? null,
    modelEvidenceHash: model?.evidence?.hash ?? null,
    modelRejections: model ? model.rejections : null,
    modelUngrounded: model ? ungrounded : null,
    modelReadAt: model ? readAt : null,
    state: r.state,
    reviewReason,
    modelSuggests: r.modelSuggests,
    typeReview: r.typeReview,
    companyReview: r.companyReview,
    roleReview: r.roleReview,
    finalType: r.type,
    finalCompany: r.company,
    finalRole: r.role,
  };
}

/**
 * One open question for a future human-review workflow. `actionable` is false while the model has not read the message
 * yet: those are waiting on a worker, not on a person.
 */
export type ReviewItem = {
  gmailMessageId: string;
  gmailThreadId: string;
  senderDomain: string;
  arrivedAt: Date;
  reason: ReviewReason;
  actionable: boolean;
  rules: { recruiting: boolean; type: ReaderType | null };
  model: { recruiting: boolean | null; type: string | null; certainty: string | null; status: string | null } | null;
  modelSuggests: "recruiting" | "not_recruiting" | null;
  fieldFlags: { type: boolean; company: boolean; role: boolean };
};

export function reviewItemOf(rec: ShadowRecord): ReviewItem | null {
  if (rec.state !== "review" || !rec.reviewReason) return null;
  return {
    gmailMessageId: rec.gmailMessageId,
    gmailThreadId: rec.gmailThreadId,
    senderDomain: rec.senderDomain,
    arrivedAt: rec.arrivedAt,
    reason: rec.reviewReason,
    actionable: rec.reviewReason !== "pending_model",
    rules: { recruiting: rec.rulesRecruiting, type: rec.rulesType },
    model: rec.modelStatus ? { recruiting: rec.modelRecruiting, type: rec.modelType, certainty: rec.modelCertainty, status: rec.modelStatus } : null,
    modelSuggests: rec.modelSuggests,
    fieldFlags: { type: rec.typeReview, company: rec.companyReview, role: rec.roleReview },
  };
}
