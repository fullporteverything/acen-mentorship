CREATE TABLE "migration_verification_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_manifest_checksum" varchar(128) NOT NULL,
	"destination_manifest_checksum" varchar(128) NOT NULL,
	"mismatch_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_verification_artifacts_source_unique" UNIQUE("source_manifest_checksum"),
	CONSTRAINT "migration_verification_artifacts_nonnegative_mismatches" CHECK ("migration_verification_artifacts"."mismatch_count" >= 0)
);
