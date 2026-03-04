CREATE TYPE "public"."message_type" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TYPE "public"."room_role" AS ENUM('host', 'co-host', 'participant');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" varchar(10) NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"waiting_room_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "refresh_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_room_code_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_host_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "id" SET DATA TYPE varchar(10);--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "host_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "title" varchar(255) DEFAULT 'Meeting' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "is_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "passcode_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "max_participants" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" varchar(512);--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_settings" ADD CONSTRAINT "room_settings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "room_code";--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "host_user_id";--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "updated_at";--> statement-breakpoint
DROP TYPE "public"."room_type";