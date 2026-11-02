/**
 * Vocabulary for ground truth, shared by the schema, the evaluator and the labeling tools.
 * Pure data: no database, no email content.
 */

/** Where a label came from. Provenance decides whether it may count toward headline metrics. */
export const LABEL_SOURCES = ["dev_human", "blind_human", "user_correction", "legacy_reconstructed"] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/** Sources trustworthy enough for clean headline numbers (made by a person, from the raw message, predictions hidden). */
export const HEADLINE_SOURCES: LabelSource[] = ["dev_human", "blind_human"];

export const LABEL_FIELDS = [
  "is_recruiting", // boolean
  "type", // EventType | "unknown"
  "company", // string | "unknown"
  "role", // string | "unknown" | "not_applicable"
  "opportunity_ref", // labeler-chosen group id, string
  "stage", // Stage | "unknown"
  "event_date", // ISO string | "not_applicable" | "unknown"
  "actionable", // boolean
  "urgency", // "today" | "soon" | "none"
] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

/** Explicit non-values, so "the labeler could not tell" differs from "nobody labeled this". */
export const UNKNOWN = "unknown";
export const NOT_APPLICABLE = "not_applicable";

/**
 * DEV_RANDOM:    random sample of the development mailbox. Membership frozen on creation. Honest development metric.
 * DEV_CHALLENGE: curated hard and regression cases. May be inspected and optimised against; never reported as generalisation.
 * BLIND:         a mailbox the extractor has never been developed against. One official run only.
 */
export const DATASET_KINDS = ["dev_random", "dev_challenge", "blind"] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

/** The label source a dataset's human labels must carry. */
export const SOURCE_FOR_DATASET: Record<DatasetKind, LabelSource> = {
  dev_random: "dev_human",
  dev_challenge: "dev_human",
  blind: "blind_human",
};
