ALTER TABLE "migration_runs"
  ADD COLUMN "source_manifest" jsonb,
  ADD COLUMN "source_manifest_checksum" varchar(128),
  ADD COLUMN "source_scope" text;
--> statement-breakpoint
ALTER TABLE "migration_verification_artifacts"
  ADD COLUMN "run_id" uuid,
  ADD COLUMN "verification_seal" varchar(128);
--> statement-breakpoint
ALTER TABLE "migration_verification_artifacts"
  ADD CONSTRAINT "migration_verification_artifacts_run_id_migration_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."migration_runs"("id") ON DELETE no action ON UPDATE no action;
