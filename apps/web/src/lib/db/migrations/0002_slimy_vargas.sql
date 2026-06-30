CREATE TABLE IF NOT EXISTS "service_mappings" (
	"tenant_id" text NOT NULL,
	"service_name" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'stub' NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_mappings_tenant_id_service_name_pk" PRIMARY KEY("tenant_id","service_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"api_version" text DEFAULT '' NOT NULL,
	"stripe_event" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_domains" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_token" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist" (
	"waitlist_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"magic_link" text DEFAULT '' NOT NULL,
	"token" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'signup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stripe_events_type" ON "stripe_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_domains_tenant" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_domains_domain" ON "tenant_domains" USING btree ("domain");