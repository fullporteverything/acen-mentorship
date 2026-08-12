CREATE TABLE "announcements" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"actor_member_id" uuid,
	"action" varchar(160) NOT NULL,
	"resource_type" varchar(128) NOT NULL,
	"resource_id" varchar(255),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(255) NOT NULL,
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curriculum_sections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "curriculum_sections_position_unique" UNIQUE("position")
);
--> statement-breakpoint
CREATE TABLE "homework_review_counters" (
	"submission_id" uuid NOT NULL,
	"next_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_review_counters_submission_unique" UNIQUE("submission_id"),
	CONSTRAINT "homework_review_counters_positive_next_version" CHECK ("homework_review_counters"."next_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "homework_rubric_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reviewer_member_id" uuid,
	"version" integer NOT NULL,
	"decision" varchar(16) NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"rubric" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_rubric_reviews_submission_version_unique" UNIQUE("submission_id","version"),
	CONSTRAINT "homework_rubric_reviews_positive_version" CHECK ("homework_rubric_reviews"."version" > 0),
	CONSTRAINT "homework_rubric_reviews_valid_decision" CHECK ("homework_rubric_reviews"."decision" IN ('approved', 'rejected', 'revision_requested'))
);
--> statement-breakpoint
CREATE TABLE "homework_submission_counters" (
	"member_id" uuid NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"next_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_submission_counters_member_lesson_unique" UNIQUE("member_id","lesson_id"),
	CONSTRAINT "homework_submission_counters_positive_next_version" CHECK ("homework_submission_counters"."next_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "homework_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" varchar(512) NOT NULL,
	"content_type" varchar(255) DEFAULT 'application/pdf' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homework_submissions_member_lesson_version_unique" UNIQUE("member_id","lesson_id","version"),
	CONSTRAINT "homework_submissions_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "homework_submissions_positive_version" CHECK ("homework_submissions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" varchar(512) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "journal_attachments_nonnegative_size" CHECK ("journal_attachments"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"mood" varchar(64),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feedback" text,
	"feedback_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"cue_id" uuid,
	"timestamp_milliseconds" integer NOT NULL,
	"label" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_bookmarks_member_lesson_cue_unique" UNIQUE("member_id","lesson_id","cue_id"),
	CONSTRAINT "lesson_bookmarks_nonnegative_timestamp" CHECK ("lesson_bookmarks"."timestamp_milliseconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lesson_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"completed_at" timestamp with time zone,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_progress_member_lesson_unique" UNIQUE("member_id","lesson_id"),
	CONSTRAINT "lesson_progress_valid_percentage" CHECK ("lesson_progress"."progress" >= 0 AND "lesson_progress"."progress" <= 100)
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"video_id" varchar(255),
	"position" integer NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_section_position_unique" UNIQUE("section_id","position")
);
--> statement-breakpoint
CREATE TABLE "member_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_identities_provider_account_unique" UNIQUE("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" varchar(32) NOT NULL,
	"legacy_user_id" varchar(128),
	"display_name" varchar(255),
	"avatar_url" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_discord_id_unique" UNIQUE("discord_id"),
	CONSTRAINT "members_legacy_user_id_unique" UNIQUE("legacy_user_id")
);
--> statement-breakpoint
CREATE TABLE "migration_checksums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"table_name" varchar(128) NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_checksums_run_table_unique" UNIQUE("run_id","table_name"),
	CONSTRAINT "migration_checksums_nonnegative_rows" CHECK ("migration_checksums"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "migration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"target_table" varchar(128) NOT NULL,
	"target_id" varchar(255),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_items_run_source_key_unique" UNIQUE("run_id","source_key")
);
--> statement-breakpoint
CREATE TABLE "migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"source" varchar(255) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_runs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "notification_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"notification_id" varchar(160) NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_receipts_member_notification_unique" UNIQUE("member_id","notification_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"member_id" uuid,
	"announcement_id" varchar(160),
	"notification_type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orphaned_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orphaned_uploads_upload_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(128) NOT NULL,
	"bucket_key" varchar(255) NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_scope_key_unique" UNIQUE("scope","bucket_key"),
	CONSTRAINT "rate_limit_buckets_nonnegative_hits" CHECK ("rate_limit_buckets"."hit_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"event_type" varchar(128) NOT NULL,
	"ip_hash" varchar(128),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_member_state" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"strike_limit" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_member_state_nonnegative_strikes" CHECK ("security_member_state"."strike_count" >= 0 AND "security_member_state"."strike_limit" > 0),
	CONSTRAINT "security_member_state_valid_lock" CHECK ("security_member_state"."locked_at" IS NULL OR "security_member_state"."strike_count" >= "security_member_state"."strike_limit")
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_member_id" uuid,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"subject" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_cues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"start_milliseconds" integer NOT NULL,
	"end_milliseconds" integer NOT NULL,
	"text" text NOT NULL,
	"locale" varchar(32) DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_cues_lesson_start_locale_unique" UNIQUE("lesson_id","start_milliseconds","locale"),
	CONSTRAINT "transcript_cues_valid_range" CHECK ("transcript_cues"."start_milliseconds" >= 0 AND "transcript_cues"."end_milliseconds" >= "transcript_cues"."start_milliseconds")
);
--> statement-breakpoint
CREATE TABLE "upload_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_quarantine_upload_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" varchar(512) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(128),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "uploads_nonnegative_size" CHECK ("uploads"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "watch_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"lesson_id" varchar(160) NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_progress_member_lesson_unique" UNIQUE("member_id","lesson_id"),
	CONSTRAINT "watch_progress_valid_seconds" CHECK ("watch_progress"."watched_seconds" >= 0 AND "watch_progress"."duration_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_review_counters" ADD CONSTRAINT "homework_review_counters_submission_id_homework_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."homework_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_rubric_reviews" ADD CONSTRAINT "homework_rubric_reviews_submission_id_homework_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."homework_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_rubric_reviews" ADD CONSTRAINT "homework_rubric_reviews_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_rubric_reviews" ADD CONSTRAINT "homework_rubric_reviews_reviewer_member_id_members_id_fk" FOREIGN KEY ("reviewer_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_counters" ADD CONSTRAINT "homework_submission_counters_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submission_counters" ADD CONSTRAINT "homework_submission_counters_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_cue_id_transcript_cues_id_fk" FOREIGN KEY ("cue_id") REFERENCES "public"."transcript_cues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_section_id_curriculum_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."curriculum_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identities" ADD CONSTRAINT "member_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_checksums" ADD CONSTRAINT "migration_checksums_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."migration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_items" ADD CONSTRAINT "migration_items_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."migration_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orphaned_uploads" ADD CONSTRAINT "orphaned_uploads_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_member_state" ADD CONSTRAINT "security_member_state_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_cues" ADD CONSTRAINT "transcript_cues_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_quarantine" ADD CONSTRAINT "upload_quarantine_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_member_created_index" ON "audit_events" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "journals_member_created_index" ON "journals" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "lesson_notes_member_lesson_index" ON "lesson_notes" USING btree ("member_id","lesson_id");--> statement-breakpoint
CREATE INDEX "lessons_section_id_index" ON "lessons" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "member_identities_member_id_index" ON "member_identities" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "notification_receipts_member_seen_index" ON "notification_receipts" USING btree ("member_id","seen_at");--> statement-breakpoint
CREATE INDEX "notifications_member_delivered_index" ON "notifications" USING btree ("member_id","delivered_at");--> statement-breakpoint
CREATE INDEX "security_events_member_occurred_index" ON "security_events" USING btree ("member_id","occurred_at");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_created_index" ON "support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_member_status_index" ON "support_tickets" USING btree ("member_id","status");