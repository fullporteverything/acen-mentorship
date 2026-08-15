CREATE TABLE "audit_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" varchar(160) NOT NULL,
  "resource_type" varchar(128) NOT NULL,
  "resource_id" varchar(255),
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_outbox_pending_index" ON "audit_outbox" USING btree ("delivered_at", "created_at");
