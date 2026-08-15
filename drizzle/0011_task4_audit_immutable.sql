CREATE OR REPLACE FUNCTION "prevent_audit_event_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_event_mutation"();
