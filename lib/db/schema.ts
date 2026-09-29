import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
