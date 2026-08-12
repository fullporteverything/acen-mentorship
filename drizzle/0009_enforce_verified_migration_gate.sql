INSERT INTO "migration_runs" ("id", "name", "source", "status")
SELECT "id", 'invalid-legacy-artifact-' || "id", 'legacy-invalid-artifact', 'invalid'
FROM "migration_verification_artifacts"
WHERE "run_id" IS NULL;
--> statement-breakpoint
UPDATE "migration_verification_artifacts"
SET
  "run_id" = COALESCE("run_id", "id"),
  "verification_seal" = COALESCE("verification_seal", 'invalid-legacy-artifact'),
  "expires_at" = CASE
    WHEN "expires_at" IS NULL OR "expires_at" <= "verified_at" THEN "verified_at" + interval '1 second'
    ELSE "expires_at"
  END;
--> statement-breakpoint
ALTER TABLE "migration_verification_artifacts"
  ALTER COLUMN "run_id" SET NOT NULL,
  ALTER COLUMN "verification_seal" SET NOT NULL,
  ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "migration_verification_artifacts"
  ADD CONSTRAINT "migration_verification_artifacts_expiry_bounded"
  CHECK ("expires_at" > "verified_at" AND "expires_at" <= "verified_at" + interval '30 minutes');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_migration_run_source_mutation"()
RETURNS trigger AS $$
BEGIN
  IF OLD."source_manifest" IS DISTINCT FROM NEW."source_manifest"
     OR OLD."source_manifest_checksum" IS DISTINCT FROM NEW."source_manifest_checksum"
     OR OLD."source_scope" IS DISTINCT FROM NEW."source_scope" THEN
    RAISE EXCEPTION 'migration source evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "migration_runs_source_immutable"
BEFORE UPDATE ON "migration_runs"
FOR EACH ROW EXECUTE FUNCTION "prevent_migration_run_source_mutation"();
