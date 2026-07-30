CREATE TABLE IF NOT EXISTS "profile_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"document_type" varchar(80) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"mime_type" varchar(150),
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone" varchar(100);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "portfolio_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "indeed_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "target_roles" text[];--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "relevant_courses" text[];--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "education_history" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "work_history" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "project_history" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "certifications" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "autofill_answers" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_documents" ADD CONSTRAINT "profile_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
