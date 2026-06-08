CREATE TYPE "public"."message_type" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TYPE "public"."room_role" AS ENUM('host', 'co-host', 'participant');--> statement-breakpoint
CREATE TABLE "backup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
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
--> statement-breakpoint
CREATE TABLE "login_events" (
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
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" varchar(10) NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"code" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_sessions" (
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
--> statement-breakpoint
CREATE TABLE "recording_tracks" (
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
--> statement-breakpoint
CREATE TABLE "room_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" varchar(10) NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "room_role" NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "room_settings" (
	"room_id" varchar(10) PRIMARY KEY NOT NULL,
	"allow_screen_share" boolean DEFAULT true NOT NULL,
	"allow_chat" boolean DEFAULT true NOT NULL,
	"mute_on_join" boolean DEFAULT false NOT NULL,
	"waiting_room_enabled" boolean DEFAULT false NOT NULL,
	"reactions_enabled" boolean DEFAULT true NOT NULL,
	"max_recording_duration_mins" integer DEFAULT 120 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" varchar(10) PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"title" varchar(255) DEFAULT 'Meeting' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"passcode_hash" varchar(255),
	"max_participants" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"status" varchar(20) DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
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
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"avatar_url" varchar(512),
	"google_id" varchar(255),
	"google_linked_at" timestamp,
	"google_email" varchar(255),
	"password_hash" varchar(255),
	"email_verified" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"last_failed_login_at" timestamp,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"two_factor_secret" varchar(255),
	"two_factor_enabled_at" timestamp,
	"recovery_email" varchar(255),
	"recovery_email_verified" boolean DEFAULT false NOT NULL,
	"backup_codes_generated_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_session_id_user_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_tracks" ADD CONSTRAINT "recording_tracks_session_id_recording_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."recording_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_tracks" ADD CONSTRAINT "recording_tracks_participant_id_users_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_settings" ADD CONSTRAINT "room_settings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_codes_user_used_at_idx" ON "backup_codes" USING btree ("user_id","used_at");--> statement-breakpoint
CREATE INDEX "deletion_requests_user_requested_idx" ON "deletion_requests" USING btree ("user_id","requested_at" desc);--> statement-breakpoint
CREATE INDEX "deletion_requests_original_email_idx" ON "deletion_requests" USING btree ("original_email");--> statement-breakpoint
CREATE INDEX "login_events_user_created_at_idx" ON "login_events" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "login_events_user_suspicious_idx" ON "login_events" USING btree ("user_id","is_suspicious");--> statement-breakpoint
CREATE INDEX "idx_messages_room_id" ON "messages" USING btree ("room_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_created_at_idx" ON "password_reset_tokens" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "idx_rp_room_user" ON "room_participants" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_user_revoked_expires_idx" ON "user_sessions" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "user_sessions_token_hash_idx" ON "user_sessions" USING btree ("token_hash");