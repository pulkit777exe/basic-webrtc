ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_linked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "google_email" varchar(255),
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

CREATE TABLE IF NOT EXISTS "deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "original_email" varchar(255) NOT NULL,
  "original_name" varchar(255) NOT NULL,
  "original_password_hash" varchar(255),
  "original_email_verified" boolean DEFAULT false NOT NULL,
  "original_avatar_url" varchar(512),
  "original_google_id" varchar(255),
  "original_google_email" varchar(255),
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "cancelled_at" timestamp,
  "processed_at" timestamp,
  "scheduled_for" timestamp NOT NULL,
  "job_id" varchar(255)
);

CREATE INDEX IF NOT EXISTS "deletion_requests_user_requested_idx"
  ON "deletion_requests" ("user_id", "requested_at" DESC);

CREATE INDEX IF NOT EXISTS "deletion_requests_original_email_idx"
  ON "deletion_requests" ("original_email");
