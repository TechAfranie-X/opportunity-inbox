CREATE TABLE "evidence_ledgers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_google_sub" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"reader_version" text NOT NULL,
	"decision_version" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"sender_domain" text DEFAULT '' NOT NULL,
	"outbound" boolean DEFAULT false NOT NULL,
	"claims" jsonb NOT NULL,
	"verdict" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_ledgers_user_message_version_unique" UNIQUE("user_google_sub","gmail_message_id","reader_version")
);
--> statement-breakpoint
CREATE INDEX "evidence_ledgers_user_idx" ON "evidence_ledgers" USING btree ("user_google_sub");