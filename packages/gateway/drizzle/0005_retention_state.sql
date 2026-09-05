CREATE TABLE "retention_state" (
	"app_id" text PRIMARY KEY NOT NULL,
	"pruned_before" timestamp with time zone NOT NULL,
	"pruned_through_seq" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retention_state" ADD CONSTRAINT "retention_state_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;