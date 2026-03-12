ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_failed_login_at" timestamp;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_secret" varchar(255);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "suspicious_verified_at" timestamp;
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
CREATE INDEX "login_events_user_created_at_idx" ON "login_events" USING btree ("user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX "login_events_user_suspicious_idx" ON "login_events" USING btree ("user_id","is_suspicious");
--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_session_id_user_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."user_sessions"("id") ON DELETE no action ON UPDATE no action;
