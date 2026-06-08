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
  jsonb,
} from 'drizzle-orm/pg-core';
import { InferSelectModel, InferInsertModel, desc } from 'drizzle-orm';

export const roomRoleEnum = pgEnum('room_role', ['host', 'co-host', 'participant']);
export const messageTypeEnum = pgEnum('message_type', ['text', 'system']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  googleId: varchar('google_id', { length: 255 }).unique(),
  googleLinkedAt: timestamp('google_linked_at'),
  googleEmail: varchar('google_email', { length: 255 }),
  passwordHash: varchar('password_hash', { length: 255 }),
  emailVerified: boolean('email_verified').notNull().default(false),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
  lastFailedLoginAt: timestamp('last_failed_login_at'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  twoFactorSecret: varchar('two_factor_secret', { length: 255 }),
  twoFactorEnabledAt: timestamp('two_factor_enabled_at'),
  recoveryEmail: varchar('recovery_email', { length: 255 }),
  recoveryEmailVerified: boolean('recovery_email_verified').notNull().default(false),
  backupCodesGeneratedAt: timestamp('backup_codes_generated_at'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rooms = pgTable('rooms', {
  id: varchar('id', { length: 10 }).primaryKey(),
  hostId: uuid('host_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull().default('Meeting'),
  isLocked: boolean('is_locked').notNull().default(false),
  passcodeHash: varchar('passcode_hash', { length: 255 }),
  maxParticipants: integer('max_participants').notNull().default(10),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
});

export const roomParticipants = pgTable(
  'room_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: varchar('room_id', { length: 10 })
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roomRoleEnum('role').notNull(),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    leftAt: timestamp('left_at'),
  },
  (table) => ({
    roomUserIdx: index('idx_rp_room_user').on(table.roomId, table.userId),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: varchar('room_id', { length: 10 })
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    type: messageTypeEnum('type').notNull().default('text'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedAtIdx: index('idx_messages_room_id').on(table.roomId, desc(table.createdAt)),
  }),
);

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
  code: varchar('code', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const backupCodes = pgTable(
  'backup_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    userUsedAtIdx: index('backup_codes_user_used_at_idx').on(table.userId, table.usedAt),
  }),
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    deviceName: varchar('device_name', { length: 255 }),
    deviceType: varchar('device_type', { length: 20 }),
    browser: varchar('browser', { length: 100 }),
    os: varchar('os', { length: 100 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    location: varchar('location', { length: 255 }),
    lastActiveAt: timestamp('last_active_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    revokedAt: timestamp('revoked_at'),
    expiresAt: timestamp('expires_at').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    suspiciousVerifiedAt: timestamp('suspicious_verified_at'),
  },
  (table) => ({
    userRevokedExpiresIdx: index('user_sessions_user_revoked_expires_idx').on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    tokenHashIdx: index('user_sessions_token_hash_idx').on(table.tokenHash),
  }),
);

export const loginEvents = pgTable(
  'login_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: uuid('session_id').references(() => userSessions.id, { onDelete: 'cascade' }),
    ipAddress: varchar('ip_address', { length: 45 }).notNull(),
    country: varchar('country', { length: 100 }),
    city: varchar('city', { length: 100 }),
    deviceFingerprint: varchar('device_fingerprint', { length: 64 }),
    browser: varchar('browser', { length: 100 }),
    os: varchar('os', { length: 100 }),
    deviceType: varchar('device_type', { length: 20 }),
    isSuspicious: boolean('is_suspicious').notNull().default(false),
    suspiciousReasons: jsonb('suspicious_reasons'),
    alertSent: boolean('alert_sent').notNull().default(false),
    confirmedAt: timestamp('confirmed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userCreatedAtIdx: index('login_events_user_created_at_idx').on(
      table.userId,
      desc(table.createdAt),
    ),
    userSuspiciousIdx: index('login_events_user_suspicious_idx').on(
      table.userId,
      table.isSuspicious,
    ),
  }),
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: index('password_reset_tokens_token_hash_idx').on(table.tokenHash),
    userCreatedAtIdx: index('password_reset_tokens_user_created_at_idx').on(
      table.userId,
      desc(table.createdAt),
    ),
  }),
);

export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    originalEmail: varchar('original_email', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    originalPasswordHash: varchar('original_password_hash', { length: 255 }),
    originalEmailVerified: boolean('original_email_verified').notNull().default(false),
    originalAvatarUrl: varchar('original_avatar_url', { length: 512 }),
    originalGoogleId: varchar('original_google_id', { length: 255 }),
    originalGoogleEmail: varchar('original_google_email', { length: 255 }),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at'),
    processedAt: timestamp('processed_at'),
    scheduledFor: timestamp('scheduled_for').notNull(),
    jobId: varchar('job_id', { length: 255 }),
  },
  (table) => ({
    userRequestedIdx: index('deletion_requests_user_requested_idx').on(
      table.userId,
      desc(table.requestedAt),
    ),
    originalEmailIdx: index('deletion_requests_original_email_idx').on(table.originalEmail),
  }),
);

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
export type BackupCode = InferSelectModel<typeof backupCodes>;
export type InsertBackupCode = InferInsertModel<typeof backupCodes>;
export type UserSession = InferSelectModel<typeof userSessions>;
export type InsertUserSession = InferInsertModel<typeof userSessions>;
export type LoginEvent = InferSelectModel<typeof loginEvents>;
export type InsertLoginEvent = InferInsertModel<typeof loginEvents>;
export type PasswordResetToken = InferSelectModel<typeof passwordResetTokens>;
export type InsertPasswordResetToken = InferInsertModel<typeof passwordResetTokens>;
export type DeletionRequest = InferSelectModel<typeof deletionRequests>;
export type InsertDeletionRequest = InferInsertModel<typeof deletionRequests>;
