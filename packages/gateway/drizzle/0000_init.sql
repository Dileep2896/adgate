CREATE TABLE "advertisers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisers_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"key_prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"role" text NOT NULL,
	"advertiser_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_prefix_unique" UNIQUE("key_prefix"),
	CONSTRAINT "api_keys_role_check" CHECK ("api_keys"."role" in ('app', 'advertiser_read')),
	CONSTRAINT "api_keys_advertiser_check" CHECK (("api_keys"."role" = 'advertiser_read') = ("api_keys"."advertiser_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"salt" text NOT NULL,
	"policy_yaml" text NOT NULL,
	"policy_hash" text NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"affiliate_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_records" (
	"record_hash" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"app_id" text NOT NULL,
	"prev_hash" text NOT NULL,
	"supersedes_hash" text,
	"is_latest" boolean DEFAULT true NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"creative_id" text,
	"advertiser_id" text,
	"ts" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_records_decision_check" CHECK ("audit_records"."decision" in ('serve', 'suppress'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_id" text NOT NULL,
	"app_id" text NOT NULL,
	"type" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_type_check" CHECK ("events"."type" in ('impression', 'click', 'dismiss', 'conversion'))
);
--> statement-breakpoint
CREATE TABLE "raw_text" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cap_state" (
	"app_id" text NOT NULL,
	"conversation_hash" text NOT NULL,
	"user_hash" text,
	"session_count" integer DEFAULT 0 NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"last_turn_index" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cap_state_pkey" PRIMARY KEY("app_id","conversation_hash")
);
--> statement-breakpoint
CREATE TABLE "classify_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"classification" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_day_caps" (
	"app_id" text NOT NULL,
	"user_hash" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_day_caps_pkey" PRIMARY KEY("app_id","user_hash","day")
);
--> statement-breakpoint
CREATE TABLE "creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_id" text NOT NULL,
	"app_id" text,
	"headline" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"cta" text NOT NULL,
	"url_template" text NOT NULL,
	"target_categories" text[] NOT NULL,
	"target_regions" text[] NOT NULL,
	"keywords" text[] NOT NULL,
	"ecpm" numeric(12, 4) NOT NULL,
	"source" text NOT NULL,
	"network" text,
	"program_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creatives_source_check" CHECK ("creatives"."source" in ('direct', 'affiliate', 'koah', 'gravity')),
	CONSTRAINT "creatives_ecpm_check" CHECK ("creatives"."ecpm" >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_text" ADD CONSTRAINT "raw_text_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cap_state" ADD CONSTRAINT "cap_state_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_day_caps" ADD CONSTRAINT "user_day_caps_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_app_id_idx" ON "api_keys" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "audit_records_app_id_ts_idx" ON "audit_records" USING btree ("app_id","ts");--> statement-breakpoint
CREATE INDEX "audit_records_id_idx" ON "audit_records" USING btree ("id");--> statement-breakpoint
CREATE INDEX "audit_records_app_id_is_latest_idx" ON "audit_records" USING btree ("app_id","is_latest");--> statement-breakpoint
CREATE INDEX "audit_records_advertiser_id_ts_idx" ON "audit_records" USING btree ("advertiser_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_records_one_latest_per_id_uidx" ON "audit_records" USING btree ("id") WHERE is_latest = true;--> statement-breakpoint
CREATE INDEX "events_audit_id_idx" ON "events" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "events_app_id_ts_idx" ON "events" USING btree ("app_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "events_one_impression_per_audit_uidx" ON "events" USING btree ("audit_id") WHERE type = 'impression';--> statement-breakpoint
CREATE INDEX "classify_cache_expires_at_idx" ON "classify_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "creatives_advertiser_id_idx" ON "creatives" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "creatives_app_id_idx" ON "creatives" USING btree ("app_id");