ALTER TABLE "users" ADD COLUMN "recovery_email" varchar(255);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_email_verified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "backup_codes_generated_at" timestamp;
--> statement-breakpoint
CREATE TABLE "backup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
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
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backup_codes_user_used_at_idx" ON "backup_codes" USING btree ("user_id","used_at");
--> statement-breakpoint
CREATE INDEX "user_sessions_user_revoked_expires_idx" ON "user_sessions" USING btree ("user_id","revoked_at","expires_at");
--> statement-breakpoint
CREATE INDEX "user_sessions_token_hash_idx" ON "user_sessions" USING btree ("token_hash");
--> statement-breakpoint
ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
