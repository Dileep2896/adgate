ALTER TABLE "audit_records" ADD COLUMN "seq" integer;--> statement-breakpoint
UPDATE "audit_records" AS a SET "seq" = n."seq" FROM (SELECT "record_hash", row_number() OVER (PARTITION BY "app_id" ORDER BY "ts", "created_at", "record_hash") AS "seq" FROM "audit_records") AS n WHERE a."record_hash" = n."record_hash";--> statement-breakpoint
CREATE UNIQUE INDEX "audit_records_app_id_seq_uidx" ON "audit_records" USING btree ("app_id","seq");--> statement-breakpoint
ALTER TABLE "audit_records" ALTER COLUMN "seq" SET NOT NULL;
