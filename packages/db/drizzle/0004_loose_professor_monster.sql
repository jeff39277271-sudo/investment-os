CREATE TYPE "public"."notification_channel" AS ENUM('LINE');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_trigger_event_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient_identity_id" uuid,
	"status" "notification_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_alert_trigger_event_id_channel_unique" UNIQUE("alert_trigger_event_id","channel")
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_trigger_event_id_alert_trigger_events_id_fk" FOREIGN KEY ("alert_trigger_event_id") REFERENCES "public"."alert_trigger_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_identity_id_user_identities_id_fk" FOREIGN KEY ("recipient_identity_id") REFERENCES "public"."user_identities"("id") ON DELETE no action ON UPDATE no action;