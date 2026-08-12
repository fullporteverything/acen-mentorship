CREATE TABLE "legacy_blob_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family" varchar(64) NOT NULL,
	"record_key" text NOT NULL,
	"member_discord_id" varchar(128),
	"payload" jsonb NOT NULL,
	"source_path" text,
	"source_checksum" varchar(128) NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_blob_records_family_key_unique" UNIQUE("family","record_key")
);
--> statement-breakpoint
CREATE INDEX "legacy_blob_records_member_family_index" ON "legacy_blob_records" USING btree ("member_discord_id","family");