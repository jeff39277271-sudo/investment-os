CREATE TABLE "instrument_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"currency" text NOT NULL,
	"quote_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_quotes_instrument_id_source_quote_at_unique" UNIQUE("instrument_id","source","quote_at")
);
--> statement-breakpoint
ALTER TABLE "instrument_quotes" ADD CONSTRAINT "instrument_quotes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;