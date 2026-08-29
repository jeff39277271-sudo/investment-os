CREATE TYPE "public"."alert_condition_state" AS ENUM('CLEAR', 'BREACHED');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_status" AS ENUM('ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_type" AS ENUM('STOP_LOSS', 'TAKE_PROFIT');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"type" "alert_rule_type" NOT NULL,
	"trigger_price" numeric(30, 12) NOT NULL,
	"currency" text NOT NULL,
	"status" "alert_rule_status" DEFAULT 'ACTIVE' NOT NULL,
	"condition_state" "alert_condition_state" DEFAULT 'CLEAR' NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_trigger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_rule_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"observed_price" numeric(30, 12) NOT NULL,
	"trigger_price" numeric(30, 12) NOT NULL,
	"quote_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_trigger_events_alert_rule_id_quote_id_unique" UNIQUE("alert_rule_id","quote_id")
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_trigger_events" ADD CONSTRAINT "alert_trigger_events_alert_rule_id_alert_rules_id_fk" FOREIGN KEY ("alert_rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_trigger_events" ADD CONSTRAINT "alert_trigger_events_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_trigger_events" ADD CONSTRAINT "alert_trigger_events_quote_id_instrument_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."instrument_quotes"("id") ON DELETE no action ON UPDATE no action;