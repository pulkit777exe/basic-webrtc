-- Drop dependent tables first
ALTER TABLE IF EXISTS "rooms" DROP CONSTRAINT IF EXISTS "rooms_host_user_id_users_id_fk";
DROP TABLE IF EXISTS "rooms";
DROP TABLE IF EXISTS "refresh_tokens";

-- Alter users: rename username -> name, add avatar_url, drop updated_at
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique";
ALTER TABLE "users" RENAME COLUMN "username" TO "name";
ALTER TABLE "users" ALTER COLUMN "name" SET DATA TYPE varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" varchar(512);
ALTER TABLE "users" DROP COLUMN IF EXISTS "updated_at";

DROP TYPE IF EXISTS "public"."room_type";

-- New enums and tables
CREATE TYPE "public"."room_role" AS ENUM('host', 'co-host', 'participant');
CREATE TYPE "public"."message_type" AS ENUM('text', 'system');

CREATE TABLE "rooms" (
  "id" varchar(10) PRIMARY KEY NOT NULL,
  "host_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  "title" varchar(255) DEFAULT 'Meeting' NOT NULL,
  "is_locked" boolean DEFAULT false NOT NULL,
  "passcode_hash" varchar(255),
  "max_participants" integer DEFAULT 50 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "ended_at" timestamp
);

CREATE TABLE "room_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" varchar(10) NOT NULL REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  "role" "room_role" NOT NULL,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "left_at" timestamp
);

CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" varchar(10) NOT NULL REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  "content" text NOT NULL,
  "type" "message_type" DEFAULT 'text' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "room_settings" (
  "room_id" varchar(10) PRIMARY KEY NOT NULL REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action,
  "allow_screen_share" boolean DEFAULT true NOT NULL,
  "allow_chat" boolean DEFAULT true NOT NULL,
  "mute_on_join" boolean DEFAULT false NOT NULL,
  "waiting_room_enabled" boolean DEFAULT false NOT NULL
);
