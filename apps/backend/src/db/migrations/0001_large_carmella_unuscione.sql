CREATE TABLE IF NOT EXISTS "saved_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "external_id" varchar(255);--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "normalized_title" varchar(255);--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "remote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "employment_type" varchar(100);--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "experience_level" varchar(100);--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "salary_min" integer;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "salary_max" integer;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "currency" varchar(10);--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "requirements" text[];--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "posted_at" timestamp;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_job_id_job_postings_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_jobs_user_id_job_id_unique" ON "saved_jobs" ("user_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_postings_job_url_unique" ON "job_postings" ("job_url");