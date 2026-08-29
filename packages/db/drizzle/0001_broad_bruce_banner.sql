CREATE TYPE "public"."line_webhook_event_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "line_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"status" "line_webhook_event_status" DEFAULT 'PROCESSING' NOT NULL,
	"event_type" text NOT NULL,
	"provider_user_id_hash" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
