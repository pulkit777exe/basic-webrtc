import { pgTable, index, foreignKey, uuid, varchar, timestamp, boolean, jsonb, integer, bigint, text, unique, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const messageType = pgEnum("message_type", ['text', 'system'])
export const roomRole = pgEnum("room_role", ['host', 'co-host', 'participant'])


export const backupCodes = pgTable("backup_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	codeHash: varchar("code_hash", { length: 64 }).notNull(),
	usedAt: timestamp("used_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("backup_codes_user_used_at_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.usedAt.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "backup_codes_user_id_users_id_fk"
		}),
]);

export const userSessions = pgTable("user_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	deviceName: varchar("device_name", { length: 255 }),
	deviceType: varchar("device_type", { length: 20 }),
	browser: varchar({ length: 100 }),
	os: varchar({ length: 100 }),
	ipAddress: varchar("ip_address", { length: 45 }),
	location: varchar({ length: 255 }),
	lastActiveAt: timestamp("last_active_at", { mode: 'string' }).defaultNow(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	revokedAt: timestamp("revoked_at", { mode: 'string' }),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	isCurrent: boolean("is_current").default(false).notNull(),
	suspiciousVerifiedAt: timestamp("suspicious_verified_at", { mode: 'string' }),
}, (table) => [
	index("user_sessions_token_hash_idx").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("user_sessions_user_revoked_expires_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.revokedAt.asc().nullsLast().op("timestamp_ops"), table.expiresAt.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_sessions_user_id_users_id_fk"
		}),
]);

export const loginEvents = pgTable("login_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	sessionId: uuid("session_id"),
	ipAddress: varchar("ip_address", { length: 45 }).notNull(),
	country: varchar({ length: 100 }),
	city: varchar({ length: 100 }),
	deviceFingerprint: varchar("device_fingerprint", { length: 64 }),
	browser: varchar({ length: 100 }),
	os: varchar({ length: 100 }),
	deviceType: varchar("device_type", { length: 20 }),
	isSuspicious: boolean("is_suspicious").default(false).notNull(),
	suspiciousReasons: jsonb("suspicious_reasons"),
	alertSent: boolean("alert_sent").default(false).notNull(),
	confirmedAt: timestamp("confirmed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("login_events_user_created_at_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("login_events_user_suspicious_idx").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isSuspicious.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "login_events_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [userSessions.id],
			name: "login_events_session_id_user_sessions_id_fk"
		}),
]);

export const recordingSessions = pgTable("recording_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: varchar("room_id", { length: 10 }),
	sessionId: varchar("session_id", { length: 64 }).notNull(),
	startedBy: uuid("started_by"),
	startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	status: varchar({ length: 20 }).default('recording').notNull(),
	participantCount: integer("participant_count").notNull(),
	outputPath: varchar("output_path", { length: 500 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "recording_sessions_room_id_rooms_id_fk"
		}),
	foreignKey({
			columns: [table.startedBy],
			foreignColumns: [users.id],
			name: "recording_sessions_started_by_users_id_fk"
		}),
]);

export const recordingTracks = pgTable("recording_tracks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id"),
	participantId: uuid("participant_id"),
	status: varchar({ length: 20 }).default('pending').notNull(),
	s3Key: varchar("s3_key", { length: 500 }),
	durationMs: integer("duration_ms"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
	errorMessage: text("error_message"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [recordingSessions.id],
			name: "recording_tracks_session_id_recording_sessions_id_fk"
		}),
	foreignKey({
			columns: [table.participantId],
			foreignColumns: [users.id],
			name: "recording_tracks_participant_id_users_id_fk"
		}),
]);

export const deletionRequests = pgTable("deletion_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	originalEmail: varchar("original_email", { length: 255 }).notNull(),
	originalName: varchar("original_name", { length: 255 }).notNull(),
	originalPasswordHash: varchar("original_password_hash", { length: 255 }),
	originalEmailVerified: boolean("original_email_verified").default(false).notNull(),
	originalAvatarUrl: varchar("original_avatar_url", { length: 512 }),
	originalGoogleId: varchar("original_google_id", { length: 255 }),
	originalGoogleEmail: varchar("original_google_email", { length: 255 }),
	requestedAt: timestamp("requested_at", { mode: 'string' }).defaultNow().notNull(),
	cancelledAt: timestamp("cancelled_at", { mode: 'string' }),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }).notNull(),
	jobId: varchar("job_id", { length: 255 }),
}, (table) => [
	index("deletion_requests_original_email_idx").using("btree", table.originalEmail.asc().nullsLast().op("text_ops")),
	index("deletion_requests_user_requested_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.requestedAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "deletion_requests_user_id_fkey"
		}).onDelete("set null"),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: varchar("room_id", { length: 10 }).notNull(),
	userId: uuid("user_id").notNull(),
	content: text().notNull(),
	type: messageType().default('text').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_messages_room_id").using("btree", table.roomId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "messages_room_id_rooms_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "messages_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const roomParticipants = pgTable("room_participants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: varchar("room_id", { length: 10 }).notNull(),
	userId: uuid("user_id").notNull(),
	role: roomRole().notNull(),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
	leftAt: timestamp("left_at", { mode: 'string' }),
}, (table) => [
	index("idx_rp_room_user").using("btree", table.roomId.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "room_participants_room_id_rooms_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "room_participants_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const rooms = pgTable("rooms", {
	id: varchar({ length: 10 }).primaryKey().notNull(),
	hostId: uuid("host_id").notNull(),
	title: varchar({ length: 255 }).default('Meeting').notNull(),
	isLocked: boolean("is_locked").default(false).notNull(),
	passcodeHash: varchar("passcode_hash", { length: 255 }),
	maxParticipants: integer("max_participants").default(50).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	status: varchar({ length: 20 }).default('active').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.hostId],
			foreignColumns: [users.id],
			name: "rooms_host_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	avatarUrl: varchar("avatar_url", { length: 512 }),
	googleId: varchar("google_id", { length: 255 }),
	passwordHash: varchar("password_hash", { length: 255 }),
	emailVerified: boolean("email_verified").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	googleLinkedAt: timestamp("google_linked_at", { mode: 'string' }),
	googleEmail: varchar("google_email", { length: 255 }),
	deletedAt: timestamp("deleted_at", { mode: 'string' }),
	failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
	lockedUntil: timestamp("locked_until", { mode: 'string' }),
	lastFailedLoginAt: timestamp("last_failed_login_at", { mode: 'string' }),
	twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
	twoFactorSecret: varchar("two_factor_secret", { length: 255 }),
	twoFactorEnabledAt: timestamp("two_factor_enabled_at", { mode: 'string' }),
	recoveryEmail: varchar("recovery_email", { length: 255 }),
	recoveryEmailVerified: boolean("recovery_email_verified").default(false).notNull(),
	backupCodesGeneratedAt: timestamp("backup_codes_generated_at", { mode: 'string' }),
}, (table) => [
	unique("users_email_unique").on(table.email),
	unique("users_google_id_unique").on(table.googleId),
]);

export const roomSettings = pgTable("room_settings", {
	roomId: varchar("room_id", { length: 10 }).primaryKey().notNull(),
	allowScreenShare: boolean("allow_screen_share").default(true).notNull(),
	allowChat: boolean("allow_chat").default(true).notNull(),
	muteOnJoin: boolean("mute_on_join").default(false).notNull(),
	waitingRoomEnabled: boolean("waiting_room_enabled").default(false).notNull(),
	reactionsEnabled: boolean("reactions_enabled").default(true).notNull(),
	maxRecordingDurationMins: integer("max_recording_duration_mins").default(120).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [rooms.id],
			name: "room_settings_room_id_rooms_id_fk"
		}).onDelete("cascade"),
]);

export const otpCodes = pgTable("otp_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	code: varchar({ length: 255 }).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	verified: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	usedAt: timestamp("used_at", { mode: 'string' }),
	ipAddress: varchar("ip_address", { length: 45 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("password_reset_tokens_token_hash_idx").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("password_reset_tokens_user_created_at_idx").using("btree", table.userId.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "password_reset_tokens_user_id_users_id_fk"
		}),
]);
