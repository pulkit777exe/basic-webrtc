-- Idempotent patch: adds all columns/tables that the Drizzle schema expects
-- but the DB is missing (migrations were never applied or partially applied).
-- Safe to run multiple times.

-- ── rooms: add missing columns ────────────────────────────────────
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;

-- ── users: add missing columns ────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_linked_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_email" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_failed_login_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_secret" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recovery_email" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recovery_email_verified" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backup_codes_generated_at" timestamp;

-- ── room_settings: add missing columns ────────────────────────────
ALTER TABLE "room_settings" ADD COLUMN IF NOT EXISTS "reactions_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "room_settings" ADD COLUMN IF NOT EXISTS "max_recording_duration_mins" integer DEFAULT 120 NOT NULL;

-- ── otp_codes: widen code column ──────────────────────────────────
ALTER TABLE "otp_codes" ALTER COLUMN "code" TYPE varchar(255);

-- ── password_reset_tokens ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "ip_address" varchar(45),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_created_at_idx" ON "password_reset_tokens" USING btree ("user_id","created_at" DESC);
DO $$ BEGIN
  ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── backup_codes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "backup_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "backup_codes_user_used_at_idx" ON "backup_codes" USING btree ("user_id","used_at");
DO $$ BEGIN
  ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── user_sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "device_name" varchar(255),
  "device_type" varchar(20),
  "browser" varchar(100),
  "os" varchar(100),
  "ip_address" varchar(45),
  "location" varchar(255),
  "last_active_at" timestamp DEFAULT now(),
  "created_at" timestamp DEFAULT now(),
  "revoked_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "is_current" boolean DEFAULT false NOT NULL,
  "suspicious_verified_at" timestamp
);
CREATE INDEX IF NOT EXISTS "user_sessions_user_revoked_expires_idx" ON "user_sessions" USING btree ("user_id","revoked_at","expires_at");
CREATE INDEX IF NOT EXISTS "user_sessions_token_hash_idx" ON "user_sessions" USING btree ("token_hash");
DO $$ BEGIN
  ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── login_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "login_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "session_id" uuid,
  "ip_address" varchar(45) NOT NULL,
  "country" varchar(100),
  "city" varchar(100),
  "device_fingerprint" varchar(64),
  "browser" varchar(100),
  "os" varchar(100),
  "device_type" varchar(20),
  "is_suspicious" boolean DEFAULT false NOT NULL,
  "suspicious_reasons" jsonb,
  "alert_sent" boolean DEFAULT false NOT NULL,
  "confirmed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "login_events_user_created_at_idx" ON "login_events" USING btree ("user_id","created_at" DESC);
CREATE INDEX IF NOT EXISTS "login_events_user_suspicious_idx" ON "login_events" USING btree ("user_id","is_suspicious");
DO $$ BEGIN
  ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "login_events" ADD CONSTRAINT "login_events_session_id_user_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── recording_sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "recording_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" varchar(10),
  "session_id" varchar(64) NOT NULL,
  "started_by" uuid,
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp,
  "status" varchar(20) DEFAULT 'recording' NOT NULL,
  "participant_count" integer NOT NULL,
  "output_path" varchar(500),
  "created_at" timestamp DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_room_id_rooms_id_fk"
    FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_started_by_users_id_fk"
    FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── recording_tracks ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "recording_tracks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid,
  "participant_id" uuid,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "s3_key" varchar(500),
  "duration_ms" integer,
  "file_size_bytes" bigint,
  "error_message" text,
  "updated_at" timestamp DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE "recording_tracks" ADD CONSTRAINT "recording_tracks_session_id_recording_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."recording_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "recording_tracks" ADD CONSTRAINT "recording_tracks_participant_id_users_id_fk"
    FOREIGN KEY ("participant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── deletion_requests ─────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS "deletion_requests_user_requested_idx" ON "deletion_requests" ("user_id", "requested_at" DESC);
CREATE INDEX IF NOT EXISTS "deletion_requests_original_email_idx" ON "deletion_requests" ("original_email");

-- ── messages index (if missing) ──────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_messages_room_id" ON "messages" ("room_id", "created_at" DESC);

-- ── room_participants index (if missing) ──────────────────────────
CREATE INDEX IF NOT EXISTS "idx_rp_room_user" ON "room_participants" ("room_id", "user_id");
