import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  pgEnum,
  integer,
  text,
  bigint,
  index,
} from 'drizzle-orm/pg-core';
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

export const roomRoleEnum = pgEnum('room_role', ['host', 'co-host', 'participant']);
export const messageTypeEnum = pgEnum('message_type', ['text', 'system']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  googleId: varchar('google_id', { length: 255 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rooms = pgTable('rooms', {
  id: varchar('id', { length: 10 }).primaryKey(),
  hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull().default('Meeting'),
  isLocked: boolean('is_locked').notNull().default(false),
  passcodeHash: varchar('passcode_hash', { length: 255 }),
  maxParticipants: integer('max_participants').notNull().default(50),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
});

export const roomParticipants = pgTable('room_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: varchar('room_id', { length: 10 })
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roomRoleEnum('role').notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  leftAt: timestamp('left_at'),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: varchar('room_id', { length: 10 })
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  type: messageTypeEnum('type').notNull().default('text'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const roomSettings = pgTable('room_settings', {
  roomId: varchar('room_id', { length: 10 })
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  allowScreenShare: boolean('allow_screen_share').notNull().default(true),
  allowChat: boolean('allow_chat').notNull().default(true),
  muteOnJoin: boolean('mute_on_join').notNull().default(false),
  waitingRoomEnabled: boolean('waiting_room_enabled').notNull().default(false),
  reactionsEnabled: boolean('reactions_enabled').notNull().default(true),
  maxRecordingDurationMins: integer('max_recording_duration_mins').notNull().default(120),
});

// New tables for recordings
export const recordingSessions = pgTable('recording_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: varchar('room_id', { length: 10 }).references(() => rooms.id),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  startedBy: uuid('started_by').references(() => users.id),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  status: varchar('status', { length: 20 }).notNull().default('recording'),
  participantCount: integer('participant_count').notNull(),
  outputPath: varchar('output_path', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const recordingTracks = pgTable('recording_tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => recordingSessions.id),
  participantId: uuid('participant_id').references(() => users.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  s3Key: varchar('s3_key', { length: 500 }),
  durationMs: integer('duration_ms'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  errorMessage: text('error_message'),
  updatedAt: timestamp('updated_at').defaultNow(),
});



export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type User = InferSelectModel<typeof users>;
export type InsertUser = InferInsertModel<typeof users>;
export type Room = InferSelectModel<typeof rooms>;
export type InsertRoom = InferInsertModel<typeof rooms>;
export type RoomParticipant = InferSelectModel<typeof roomParticipants>;
export type InsertRoomParticipant = InferInsertModel<typeof roomParticipants>;
export type Message = InferSelectModel<typeof messages>;
export type InsertMessage = InferInsertModel<typeof messages>;
export type RoomSetting = InferSelectModel<typeof roomSettings>;
export type InsertRoomSetting = InferInsertModel<typeof roomSettings>;
export type OtpCode = InferSelectModel<typeof otpCodes>;
export type InsertOtpCode = InferInsertModel<typeof otpCodes>;
