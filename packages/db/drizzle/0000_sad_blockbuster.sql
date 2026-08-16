CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('LINE', 'MOBILE_AUTH');--> statement-breakpoint
CREATE TYPE "public"."transaction_draft_status" AS ENUM('DRAFT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."transaction_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('LINE', 'LIFF', 'MOBILE_APP', 'IMPORT', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('CONFIRMED', 'VOIDED');--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"exchange" text NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"asset_type" text NOT NULL,
	"provider_symbol" text NOT NULL,
	CONSTRAINT "instruments_symbol_exchange_unique" UNIQUE("symbol","exchange")
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"average_cost" numeric(30, 12) NOT NULL,
	"realized_pnl" numeric(30, 12) NOT NULL,
	"last_price" numeric(30, 12),
	"market_value" numeric(30, 12),
	"unrealized_pnl" numeric(30, 12),
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_snapshots_portfolio_id_instrument_id_pk" PRIMARY KEY("portfolio_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" "transaction_side" NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"trade_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"fee" numeric(30, 12) DEFAULT '0' NOT NULL,
	"tax" numeric(30, 12) DEFAULT '0' NOT NULL,
	"source" "transaction_source" NOT NULL,
	"status" "transaction_draft_status" DEFAULT 'DRAFT' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"confirmation_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "transaction_drafts_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "transaction_drafts_user_id_confirmation_idempotency_key_unique" UNIQUE("user_id","confirmation_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" "transaction_side" NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"currency" text NOT NULL,
	"fee" numeric(30, 12) DEFAULT '0' NOT NULL,
	"tax" numeric(30, 12) DEFAULT '0' NOT NULL,
	"trade_at" timestamp with time zone NOT NULL,
	"source" "transaction_source" NOT NULL,
	"status" "transaction_status" DEFAULT 'CONFIRMED' NOT NULL,
	"reversal_of" uuid,
	"note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_portfolio_id_idempotency_key_unique" UNIQUE("portfolio_id","idempotency_key"),
	CONSTRAINT "transactions_draft_id_unique" UNIQUE("draft_id")
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_subject" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_provider_subject_unique" UNIQUE("provider","provider_subject")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'Asia/Taipei' NOT NULL,
	"base_currency" text DEFAULT 'TWD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_draft_id_transaction_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."transaction_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
