ALTER TABLE "migration_verification_artifacts"
  DROP CONSTRAINT "migration_verification_artifacts_source_unique";
--> statement-breakpoint
CREATE INDEX "migration_verification_artifacts_source_index"
  ON "migration_verification_artifacts" USING btree ("source_manifest_checksum");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_sealed_verification_artifact_mutation"()
RETURNS trigger AS $$
BEGIN
  IF OLD."verification_seal" IS NOT NULL
     AND OLD."verification_seal" <> 'invalid-legacy-artifact' THEN
    RAISE EXCEPTION 'sealed migration verification artifacts are append-only';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "migration_verification_artifacts_append_only"
BEFORE UPDATE OR DELETE ON "migration_verification_artifacts"
FOR EACH ROW EXECUTE FUNCTION "prevent_sealed_verification_artifact_mutation"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_migration_run_source_mutation"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."source_manifest" IS NOT NULL THEN
    RAISE EXCEPTION 'migration source evidence is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD."source_manifest" IS NOT NULL
    OR OLD."source_manifest_checksum" IS NOT NULL
    OR OLD."source_scope" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'migration source evidence is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "migration_runs_source_immutable" ON "migration_runs";
--> statement-breakpoint
CREATE TRIGGER "migration_runs_source_immutable"
BEFORE UPDATE OR DELETE ON "migration_runs"
FOR EACH ROW EXECUTE FUNCTION "prevent_migration_run_source_mutation"();
