CREATE TABLE "eval_dataset_items" (
	"dataset_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_dataset_items_unique" UNIQUE("dataset_id","gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "eval_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	"manifest_hash" text,
	"note" text,
	CONSTRAINT "eval_datasets_name_unique" UNIQUE("name"),
	CONSTRAINT "eval_datasets_kind_check" CHECK ("eval_datasets"."kind" in ('dev_random', 'dev_challenge', 'blind'))
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"extractor_version" text NOT NULL,
	"git_commit" text,
	"policy" jsonb NOT NULL,
	"label_sources" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_google_sub" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"extractor_version" text NOT NULL,
	"predicted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" text NOT NULL,
	"outbound" boolean DEFAULT false NOT NULL,
	"sender_domain" text DEFAULT '' NOT NULL,
	"type" text,
	"company" text,
	"role" text,
	"event_date" timestamp with time zone,
	"date_kind" text,
	"confidence" real,
	"field_confidence" jsonb,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "event_predictions_user_message_version_unique" UNIQUE("user_google_sub","gmail_message_id","extractor_version"),
	CONSTRAINT "event_predictions_decision_check" CHECK ("event_predictions"."decision" in ('recruiting', 'not_recruiting'))
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid,
	"user_google_sub" text,
	"gmail_message_id" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"labeler" text DEFAULT '' NOT NULL,
	"prediction_id" uuid,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_source_check" CHECK ("labels"."source" in ('dev_human', 'blind_human', 'user_correction', 'legacy_reconstructed')),
	CONSTRAINT "labels_field_check" CHECK ("labels"."field" in ('is_recruiting', 'type', 'company', 'role', 'opportunity_ref', 'stage', 'event_date', 'actionable', 'urgency')),
	CONSTRAINT "labels_owner_check" CHECK ("labels"."dataset_id" is not null or "labels"."user_google_sub" is not null),
	CONSTRAINT "labels_human_hidden_check" CHECK ("labels"."source" not in ('dev_human', 'blind_human') or "labels"."prediction_id" is null)
);
--> statement-breakpoint
ALTER TABLE "eval_dataset_items" ADD CONSTRAINT "eval_dataset_items_dataset_id_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_dataset_id_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_dataset_id_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_prediction_id_event_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."event_predictions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_dataset_idx" ON "eval_runs" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_official_per_dataset" ON "eval_runs" USING btree ("dataset_id") WHERE "eval_runs"."official";--> statement-breakpoint
CREATE INDEX "event_predictions_user_idx" ON "event_predictions" USING btree ("user_google_sub");--> statement-breakpoint
CREATE INDEX "labels_dataset_message_idx" ON "labels" USING btree ("dataset_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "labels_user_message_idx" ON "labels" USING btree ("user_google_sub","gmail_message_id");--> statement-breakpoint
-- Integrity rules the evaluation's credibility depends on. Enforced in the database so no code path can bypass them.
-- Rows may still be deleted (privacy purge); they may not be rewritten.
CREATE FUNCTION gt_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: insert a new row instead of updating', TG_TABLE_NAME;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_predictions_append_only BEFORE UPDATE ON event_predictions FOR EACH ROW EXECUTE FUNCTION gt_reject_update();
--> statement-breakpoint
CREATE TRIGGER labels_append_only BEFORE UPDATE ON labels FOR EACH ROW EXECUTE FUNCTION gt_reject_update();
--> statement-breakpoint
CREATE TRIGGER eval_runs_append_only BEFORE UPDATE ON eval_runs FOR EACH ROW EXECUTE FUNCTION gt_reject_update();
--> statement-breakpoint
CREATE FUNCTION gt_frozen_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen timestamptz; found boolean;
BEGIN
  SELECT frozen_at, true INTO frozen, found FROM eval_datasets WHERE id = COALESCE(NEW.dataset_id, OLD.dataset_id);
  IF found AND frozen IS NOT NULL THEN
    RAISE EXCEPTION 'dataset is frozen: its membership cannot change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER eval_dataset_items_frozen BEFORE INSERT OR DELETE ON eval_dataset_items FOR EACH ROW EXECUTE FUNCTION gt_frozen_membership();
--> statement-breakpoint
CREATE FUNCTION gt_dataset_freeze_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL AND (NEW.frozen_at IS DISTINCT FROM OLD.frozen_at OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash OR NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'dataset is frozen: kind, freeze time and manifest cannot change';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER eval_datasets_freeze_once BEFORE UPDATE ON eval_datasets FOR EACH ROW EXECUTE FUNCTION gt_dataset_freeze_once();
