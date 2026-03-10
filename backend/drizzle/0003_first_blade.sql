CREATE TABLE "recording_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" varchar(10),
	"session_id" varchar(64) NOT NULL,
	"started_by" uuid,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"status" varchar(20) DEFAULT 'recording' NOT NULL,
	"participant_count" integer NOT NULL,
	"output_s3_key" varchar(500),
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
ALTER TABLE "room_settings" ADD COLUMN "reactions_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "room_settings" ADD COLUMN "max_recording_duration_mins" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sessions" ADD CONSTRAINT "recording_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_tracks" ADD CONSTRAINT "recording_tracks_session_id_recording_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."recording_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_tracks" ADD CONSTRAINT "recording_tracks_participant_id_users_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;