import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const gmailConnections = pgTable("gmail_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  userGoogleSub: text("user_google_sub").notNull().unique(),
  gmailEmail: text("gmail_email").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  scope: text("scope").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per recruiting-related email, holding ONLY structured fields.
 * There is deliberately no body/snippet column. `gmail_message_id` /
 * `gmail_thread_id` let us deep-link back to the original email in Gmail.
 */
export const recruitingEvents = pgTable(
  "recruiting_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userGoogleSub: text("user_google_sub").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    outbound: boolean("outbound").notNull().default(false),
    senderName: text("sender_name").notNull(),
    senderDomain: text("sender_domain").notNull(),
    subject: text("subject").notNull(),
    type: text("type").notNull(),
    company: text("company"),
    role: text("role"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    eventDateHasTime: boolean("event_date_has_time").notNull().default(false),
    dateKind: text("date_kind"),
    confidence: real("confidence").notNull(),
    signals: jsonb("signals").$type<string[]>().notNull().default([]),
    /** Per-field confidence and doubt reasons. Null on rows written before the abstention policy. */
    fieldConfidence: jsonb("field_confidence").$type<{ type: number; company: number; role: number }>(),
    reviewReasons: jsonb("review_reasons").$type<string[]>(),
    /** User correction (see lib/recruiting/corrections.ts). Survives re-sync. */
    correction: jsonb("correction").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("recruiting_events_user_message_unique").on(
      table.userGoogleSub,
      table.gmailMessageId,
    ),
    index("recruiting_events_user_idx").on(table.userGoogleSub),
  ],
);

export const opportunityOverrides = pgTable(
  "opportunity_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userGoogleSub: text("user_google_sub").notNull(),
    opportunityKey: text("opportunity_key").notNull(),
    status: text("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("opportunity_overrides_user_key_unique").on(
      table.userGoogleSub,
      table.opportunityKey,
    ),
  ],
);

export const actionDismissals = pgTable(
  "action_dismissals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userGoogleSub: text("user_google_sub").notNull(),
    actionId: text("action_id").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("action_dismissals_user_action_unique").on(
      table.userGoogleSub,
      table.actionId,
    ),
  ],
);

export const recruitingSync = pgTable("recruiting_sync", {
  userGoogleSub: text("user_google_sub").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
  messagesScanned: real("messages_scanned").notNull().default(0),
  eventsExtracted: real("events_extracted").notNull().default(0),
});

/** Coarse product-usage events for the validation study (no content). */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userGoogleSub: text("user_google_sub").notNull(),
    kind: text("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_events_user_idx").on(table.userGoogleSub)],
);

/**
 * Append-only record of what the extractor said about a message, per extractor version.
 * Unlike `recruiting_events` (the serving table, re-materialised on every sync) rows here are never updated,
 * so a later correction can always be compared with what the system really predicted at the time.
 * Not-recruiting decisions are stored too (ids, sender domain and signals only, no subject or body): without
 * them recruiting recall cannot be computed.
 */
export const eventPredictions = pgTable(
  "event_predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userGoogleSub: text("user_google_sub").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull().defaultNow(),
    decision: text("decision").notNull(),
    outbound: boolean("outbound").notNull().default(false),
    senderDomain: text("sender_domain").notNull().default(""),
    type: text("type"),
    company: text("company"),
    role: text("role"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    dateKind: text("date_kind"),
    confidence: real("confidence"),
    fieldConfidence: jsonb("field_confidence").$type<Record<string, number>>(),
    signals: jsonb("signals").$type<string[]>().notNull().default([]),
    reviewReasons: jsonb("review_reasons").$type<string[]>().notNull().default([]),
  },
  (table) => [
    unique("event_predictions_user_message_version_unique").on(table.userGoogleSub, table.gmailMessageId, table.extractorVersion),
    index("event_predictions_user_idx").on(table.userGoogleSub),
    check("event_predictions_decision_check", sql`${table.decision} in ('recruiting', 'not_recruiting')`),
  ],
);

/** A named, fixed set of messages to evaluate on. Membership is frozen once `frozen_at` is set. */
export const evalDatasets = pgTable(
  "eval_datasets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    /** SHA-256 over the sorted member ids, recorded at freeze so any later drift is detectable. */
    manifestHash: text("manifest_hash"),
    note: text("note"),
  },
  (table) => [check("eval_datasets_kind_check", sql`${table.kind} in ('dev_random', 'dev_challenge', 'blind')`)],
);

export const evalDatasetItems = pgTable(
  "eval_dataset_items",
  {
    datasetId: uuid("dataset_id").notNull().references(() => evalDatasets.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("eval_dataset_items_unique").on(table.datasetId, table.gmailMessageId)],
);

/**
 * One human judgement about one field of one message. Append-only: a changed mind is a new row that
 * `supersedes` the old one. An unlabeled field is unknown to us, never assumed correct.
 * `source` keeps provenance distinct; only dev_human / blind_human count toward headline metrics.
 */
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Set for dataset labels; null for in-product user corrections. */
    datasetId: uuid("dataset_id").references(() => evalDatasets.id, { onDelete: "cascade" }),
    /** Set for user corrections (whose mailbox); null for dataset labels. */
    userGoogleSub: text("user_google_sub"),
    gmailMessageId: text("gmail_message_id").notNull(),
    field: text("field").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull(),
    /** Who labeled, as a short opaque tag ("me", "reviewer-1"). Never an email address. */
    labeler: text("labeler").notNull().default(""),
    /** The prediction the product showed when a correction was made. Always null for hidden-prediction dataset labels. */
    predictionId: uuid("prediction_id").references(() => eventPredictions.id, { onDelete: "set null" }),
    supersedesId: uuid("supersedes_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("labels_dataset_message_idx").on(table.datasetId, table.gmailMessageId),
    index("labels_user_message_idx").on(table.userGoogleSub, table.gmailMessageId),
    check("labels_source_check", sql`${table.source} in ('dev_human', 'blind_human', 'user_correction', 'legacy_reconstructed')`),
    check(
      "labels_field_check",
      sql`${table.field} in ('is_recruiting', 'type', 'company', 'role', 'opportunity_ref', 'stage', 'event_date', 'actionable', 'urgency')`,
    ),
    check("labels_owner_check", sql`${table.datasetId} is not null or ${table.userGoogleSub} is not null`),
    // A hidden-prediction label must never reference a prediction: that is how anchoring would be provable.
    check("labels_human_hidden_check", sql`${table.source} not in ('dev_human', 'blind_human') or ${table.predictionId} is null`),
  ],
);

/** Append-only log of evaluations. For a BLIND dataset only the first run is `official`; later runs are contaminated. */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    datasetId: uuid("dataset_id").notNull().references(() => evalDatasets.id, { onDelete: "cascade" }),
    extractorVersion: text("extractor_version").notNull(),
    gitCommit: text("git_commit"),
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
    /** Label sources included in this run's headline numbers. */
    labelSources: jsonb("label_sources").$type<string[]>().notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    /** Per-message predictions (no bodies), so a run can be audited or re-scored. */
    results: jsonb("results").$type<unknown[]>().notNull().default([]),
    official: boolean("official").notNull().default(false),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    itemCount: integer("item_count").notNull().default(0),
  },
  (table) => [
    index("eval_runs_dataset_idx").on(table.datasetId),
    uniqueIndex("eval_runs_one_official_per_dataset").on(table.datasetId).where(sql`${table.official}`),
  ],
);

/**
 * Architecture v2 SHADOW reads: what the v2 pipeline decided for a message, kept for old-vs-new comparison and a future
 * human-review workflow. Never read by the product UI. By construction there is no column for a body, subject, snippet
 * or model quote (a test enforces this); the model's evidence is a hash plus an offset, as in the reader cache.
 * `cohort`, `uniform_arm` and `arrived_at` are fixed at ingestion, before any model output exists, so a prospective
 * evaluation cannot be steered by what the system said (docs/prospective-evaluation-protocol.md).
 */
export const shadowReads = pgTable(
  "shadow_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userGoogleSub: text("user_google_sub").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    readerVersion: text("reader_version").notNull(),
    pipelineVersion: text("pipeline_version").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull(),
    senderDomain: text("sender_domain").notNull(),
    /** 'historical' (arrived before the prospective cutoff, or no cutoff set) or 'prospective'. */
    cohort: text("cohort").notNull(),
    /** Deterministic uniform-sample arm, assigned from a hash of (user, message) at ingestion. */
    uniformArm: boolean("uniform_arm").notNull(),
    /** Routing: did the candidate query match, and will the model read it. */
    isCandidate: boolean("is_candidate").notNull(),
    /** Would the CURRENT product's keyword query have fetched this message? Null: not recorded (rows from before the column existed). */
    legacyQueryMatch: boolean("legacy_query_match"),
    plannedRead: boolean("planned_read").notNull(),
    planReason: text("plan_reason").notNull(),
    // Rules reader (the frozen extractor)
    rulesRecruiting: boolean("rules_recruiting").notNull(),
    rulesType: text("rules_type"),
    rulesCompany: text("rules_company"),
    rulesRole: text("rules_role"),
    // Model reader, after deterministic verification. Null until a worker output is imported.
    modelStatus: text("model_status"),
    modelRecruiting: boolean("model_recruiting"),
    modelType: text("model_type"),
    modelStage: text("model_stage"),
    modelCompany: text("model_company"),
    modelRole: text("model_role"),
    modelCertainty: text("model_certainty"),
    modelEvidenceHash: text("model_evidence_hash"),
    modelRejections: jsonb("model_rejections").$type<string[]>(),
    modelReadAt: timestamp("model_read_at", { withTimezone: true }),
    // Resolution (consensus-and-review)
    state: text("state").notNull(),
    reviewReason: text("review_reason"),
    modelSuggests: text("model_suggests"),
    typeReview: boolean("type_review").notNull().default(false),
    companyReview: boolean("company_review").notNull().default(false),
    roleReview: boolean("role_review").notNull().default(false),
    finalType: text("final_type"),
    finalCompany: text("final_company"),
    finalRole: text("final_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("shadow_reads_user_message_version_unique").on(table.userGoogleSub, table.gmailMessageId, table.readerVersion),
    index("shadow_reads_user_state_idx").on(table.userGoogleSub, table.state),
    check("shadow_reads_state_check", sql`${table.state} in ('recruiting', 'not_recruiting', 'review')`),
    check("shadow_reads_cohort_check", sql`${table.cohort} in ('historical', 'prospective')`),
  ],
);
