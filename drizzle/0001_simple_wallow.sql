CREATE TABLE "action_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_google_sub" text NOT NULL,
	"action_id" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_dismissals_user_action_unique" UNIQUE("user_google_sub","action_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_google_sub" text NOT NULL,
	"opportunity_key" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_overrides_user_key_unique" UNIQUE("user_google_sub","opportunity_key")
);
--> statement-breakpoint
CREATE TABLE "recruiting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_google_sub" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outbound" boolean DEFAULT false NOT NULL,
	"sender_name" text NOT NULL,
	"sender_domain" text NOT NULL,
	"subject" text NOT NULL,
	"type" text NOT NULL,
	"company" text,
	"role" text,
	"event_date" timestamp with time zone,
	"event_date_has_time" boolean DEFAULT false NOT NULL,
	"date_kind" text,
	"confidence" real NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruiting_events_user_message_unique" UNIQUE("user_google_sub","gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "recruiting_sync" (
	"user_google_sub" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"messages_scanned" real DEFAULT 0 NOT NULL,
	"events_extracted" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_google_sub" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recruiting_events_user_idx" ON "recruiting_events" USING btree ("user_google_sub");--> statement-breakpoint
CREATE INDEX "usage_events_user_idx" ON "usage_events" USING btree ("user_google_sub");