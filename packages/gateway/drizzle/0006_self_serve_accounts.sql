CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('member', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_owner_user_id_idx" ON "apps" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "reports_owner_user_id_idx" ON "reports" USING btree ("owner_user_id");