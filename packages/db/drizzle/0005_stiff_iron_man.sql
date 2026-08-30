CREATE TABLE "scheduler_leases" (
	"job_name" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
