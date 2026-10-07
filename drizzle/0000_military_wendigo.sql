CREATE TABLE "card_domains" (
	"card_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	CONSTRAINT "card_domains_card_id_domain_id_pk" PRIMARY KEY("card_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question" text,
	"body" text NOT NULL,
	"source_ref" text,
	"position" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "resource_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"source_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resource_domains" (
	"resource_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	CONSTRAINT "resource_domains_resource_id_domain_id_pk" PRIMARY KEY("resource_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"blob_url" text,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"chunks_total" integer DEFAULT 0 NOT NULL,
	"chunks_done" integer DEFAULT 0 NOT NULL,
	"error" text,
	"suggested_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_domains" ADD CONSTRAINT "card_domains_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_domains" ADD CONSTRAINT "card_domains_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_chunks" ADD CONSTRAINT "resource_chunks_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_domains" ADD CONSTRAINT "resource_domains_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_domains" ADD CONSTRAINT "resource_domains_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_domains_domain_idx" ON "card_domains" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_resource_dedupe_idx" ON "cards" USING btree ("resource_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "cards_resource_position_idx" ON "cards" USING btree ("resource_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_chunks_resource_idx" ON "resource_chunks" USING btree ("resource_id","idx");--> statement-breakpoint
CREATE INDEX "resource_chunks_status_idx" ON "resource_chunks" USING btree ("resource_id","status");--> statement-breakpoint
CREATE INDEX "resource_domains_domain_idx" ON "resource_domains" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_content_hash_idx" ON "resources" USING btree ("content_hash");