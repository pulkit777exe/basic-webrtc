import { relations } from "drizzle-orm/relations";
import { users, backupCodes, userSessions, loginEvents, rooms, recordingSessions, recordingTracks, deletionRequests, messages, roomParticipants, roomSettings, passwordResetTokens } from "./schema";

export const backupCodesRelations = relations(backupCodes, ({one}) => ({
	user: one(users, {
		fields: [backupCodes.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	backupCodes: many(backupCodes),
	userSessions: many(userSessions),
	loginEvents: many(loginEvents),
	recordingSessions: many(recordingSessions),
	recordingTracks: many(recordingTracks),
	deletionRequests: many(deletionRequests),
	messages: many(messages),
	roomParticipants: many(roomParticipants),
	rooms: many(rooms),
	passwordResetTokens: many(passwordResetTokens),
}));

export const userSessionsRelations = relations(userSessions, ({one, many}) => ({
	user: one(users, {
		fields: [userSessions.userId],
		references: [users.id]
	}),
	loginEvents: many(loginEvents),
}));

export const loginEventsRelations = relations(loginEvents, ({one}) => ({
	user: one(users, {
		fields: [loginEvents.userId],
		references: [users.id]
	}),
	userSession: one(userSessions, {
		fields: [loginEvents.sessionId],
		references: [userSessions.id]
	}),
}));

export const recordingSessionsRelations = relations(recordingSessions, ({one, many}) => ({
	room: one(rooms, {
		fields: [recordingSessions.roomId],
		references: [rooms.id]
	}),
	user: one(users, {
		fields: [recordingSessions.startedBy],
		references: [users.id]
	}),
	recordingTracks: many(recordingTracks),
}));

export const roomsRelations = relations(rooms, ({one, many}) => ({
	recordingSessions: many(recordingSessions),
	messages: many(messages),
	roomParticipants: many(roomParticipants),
	user: one(users, {
		fields: [rooms.hostId],
		references: [users.id]
	}),
	roomSettings: many(roomSettings),
}));

export const recordingTracksRelations = relations(recordingTracks, ({one}) => ({
	recordingSession: one(recordingSessions, {
		fields: [recordingTracks.sessionId],
		references: [recordingSessions.id]
	}),
	user: one(users, {
		fields: [recordingTracks.participantId],
		references: [users.id]
	}),
}));

export const deletionRequestsRelations = relations(deletionRequests, ({one}) => ({
	user: one(users, {
		fields: [deletionRequests.userId],
		references: [users.id]
	}),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	room: one(rooms, {
		fields: [messages.roomId],
		references: [rooms.id]
	}),
	user: one(users, {
		fields: [messages.userId],
		references: [users.id]
	}),
}));

export const roomParticipantsRelations = relations(roomParticipants, ({one}) => ({
	room: one(rooms, {
		fields: [roomParticipants.roomId],
		references: [rooms.id]
	}),
	user: one(users, {
		fields: [roomParticipants.userId],
		references: [users.id]
	}),
}));

export const roomSettingsRelations = relations(roomSettings, ({one}) => ({
	room: one(rooms, {
		fields: [roomSettings.roomId],
		references: [rooms.id]
	}),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({one}) => ({
	user: one(users, {
		fields: [passwordResetTokens.userId],
		references: [users.id]
	}),
}));