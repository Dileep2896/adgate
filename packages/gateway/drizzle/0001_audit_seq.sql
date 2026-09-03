ALTER TABLE "audit_records" ADD COLUMN "seq" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_records_app_id_seq_uidx" ON "audit_records" USING btree ("app_id","seq");