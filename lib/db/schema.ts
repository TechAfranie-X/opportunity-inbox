import {
  boolean,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
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
