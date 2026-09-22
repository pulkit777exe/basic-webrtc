import { randomUUID } from 'crypto';
import { db } from '../../db';
import { rooms, roomParticipants, roomSettings, transcriptSegments } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  setForceMuted,
  setRoomLocked,
  setRoomReactionsEnabled,
  getRoomReactionsEnabled,
  setPeerRole,
  removePeerFromRoom,
  addToKickedList,
  canPerformAdminAction,
  getRoomMeta,
  setRoomPinnedMessage,
  getPeerRole,
  setPeerMedia,
  setActiveSpeaker,
  removeFromWaitingRoom,
  refreshParticipantTTL,
  setHandRaised,
} from '../../lib/redis-rooms';
import { publishSignal } from '../../lib/redis-streams';
import { getRoomSettings, setRoomSetting } from '../../lib/room-settings';
import { normalizeAudienceReaction } from '../../lib/audience';
import { redis } from '../../config/redis';
import { sanitizeText } from '../../utils/sanitize';
import { logger } from '../../lib/logger';
import type { MessageHandler } from './types';
import { requireRole } from './types';

// ── WebRTC signaling ─────────────────────────────────────────────

const handleOffer: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

const handleAnswer: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

const handleIce: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

const handlePing: MessageHandler = async (ctx) => {
  await refreshParticipantTTL(ctx.roomId);
  ctx.handler.send(ctx.ws, { type: 'pong' });
};

// ── Chat ─────────────────────────────────────────────────────────

const handleChat: MessageHandler = async (ctx) => {
  // Host can disable chat for the room; gated here so UI hiding is cosmetic,
  // not the control.
  const settings = await getRoomSettings(ctx.roomId);
  if (!settings.allowChat) {
    ctx.handler.sendError(ctx.ws, 'Chat is disabled by the host');
    return;
  }
  const content = sanitizeText(String(ctx.signal.content ?? '').slice(0, 2000));
  if (!content.trim()) return;
  const rawTs = Number(ctx.signal.timestamp);
  const entry = {
    roomId: ctx.roomId,
    userId: ctx.userId,
    content,
    timestamp: Number.isFinite(rawTs) && rawTs > 0 ? rawTs : Date.now(),
    id: randomUUID(),
  };
  // Write-ahead: persist to Redis before in-memory buffer for crash safety
  await ctx.handler.persistChatToRedis(ctx.roomId, entry);
  ctx.handler.bufferChat(entry);
  if (ctx.handler.getChatBufferSize() >= ctx.handler.getChatBufferFlushSize()) {
    await ctx.handler.flushChatBuffer();
  }
};

const handleChatPin: MessageHandler = async (ctx) => {
  const role = await getPeerRole(ctx.roomId, ctx.userId);
  if (role !== 'host' && role !== 'co-host') {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  const pinnedMessage = {
    messageId: sanitizeText(String(ctx.signal.messageId ?? '')).slice(0, 128),
    text: sanitizeText(String(ctx.signal.text ?? '')).slice(0, 500),
    authorName: sanitizeText(String(ctx.signal.authorName ?? '')).slice(0, 120),
  };
  if (!pinnedMessage.messageId || !pinnedMessage.text) {
    ctx.handler.sendError(ctx.ws, 'Invalid pinned message');
    return;
  }
  await setRoomPinnedMessage(ctx.roomId, pinnedMessage);
  ctx.handler.publish(ctx.roomId, {
    type: 'chat_pin',
    ...pinnedMessage,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

const handleChatReaction: MessageHandler = async (ctx) => {
  const messageId = sanitizeText(String(ctx.signal.messageId ?? '')).slice(0, 128);
  const emoji = sanitizeText(String(ctx.signal.emoji ?? '')).slice(0, 16);
  if (!messageId || !emoji) {
    ctx.handler.sendError(ctx.ws, 'Invalid chat reaction');
    return;
  }
  if (!(await getRoomReactionsEnabled(ctx.roomId))) {
    ctx.handler.sendError(ctx.ws, 'Reactions are disabled');
    return;
  }
  ctx.handler.publish(ctx.roomId, {
    type: 'chat_reaction',
    messageId,
    emoji,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

// ── Audience reactions (floating emoji) ─────────────────────────

const handleReaction: MessageHandler = async (ctx) => {
  const emoji = normalizeAudienceReaction(ctx.signal.emoji);
  if (!emoji) {
    ctx.handler.sendError(ctx.ws, 'Invalid reaction');
    return;
  }
  if (!(await getRoomReactionsEnabled(ctx.roomId))) {
    ctx.handler.sendError(ctx.ws, 'Reactions are disabled');
    return;
  }
  // 1 burst / 500ms per user keeps the overlay lively without flood risk.
  const allowed = await redis.set(
    `ratelimit:reaction:${ctx.roomId}:${ctx.userId}`,
    '1',
    { ex: 1, nx: true },
  );
  if (!allowed) return;
  ctx.handler.publish(ctx.roomId, {
    type: 'reaction',
    emoji,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

const handleCaption: MessageHandler = async (ctx) => {
  const text = sanitizeText(String(ctx.signal.text ?? '').slice(0, 2000));
  if (!text.trim()) return;
  const rawCaptionTs = Number(ctx.signal.timestamp);
  const captionTs = Number.isFinite(rawCaptionTs) && rawCaptionTs > 0 ? rawCaptionTs : Date.now();
  ctx.handler.publish(ctx.roomId, {
    type: 'caption',
    text,
    timestamp: captionTs,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
  // Persist finals for the meeting-notes engine (best-effort, throttled
  // in-process to 1 insert/sec/user — finals naturally arrive slower).
  persistTranscriptSegment(ctx.roomId, ctx.userId, text, captionTs);
};

const lastTranscriptPersist = new Map<string, number>();
const TRANSCRIPT_THROTTLE_MS = 1000;
const TRANSCRIPT_MAP_MAX = 5000;

function persistTranscriptSegment(
  roomId: string,
  userId: string,
  text: string,
  clientTimestamp: unknown,
): void {
  const now = Date.now();
  const throttleKey = `${roomId}:${userId}`;
  const last = lastTranscriptPersist.get(throttleKey) ?? 0;
  if (now - last < TRANSCRIPT_THROTTLE_MS) return;
  if (lastTranscriptPersist.size > TRANSCRIPT_MAP_MAX) lastTranscriptPersist.clear();
  lastTranscriptPersist.set(throttleKey, now);

  const ts = Number(clientTimestamp);
  const occurredAt = Number.isFinite(ts) && ts > 0 && Math.abs(now - ts) < 24 * 3600 * 1000 ? Math.floor(ts) : now;
  db.insert(transcriptSegments)
    .values({ roomId, userId, text, occurredAt })
    .catch((e) => logger.debug('transcript persist failed', { roomId, err: String(e) }));
}

// ── Media ────────────────────────────────────────────────────────

const handleMediaState: MessageHandler = async (ctx) => {
  const settings = await getRoomSettings(ctx.roomId);
  const wantsScreen = Boolean(ctx.signal.screen) && settings.allowScreenShare;
  setPeerMedia(ctx.roomId, ctx.userId, {
    video: Boolean(ctx.signal.video),
    audio: Boolean(ctx.signal.audio),
    screen: wantsScreen,
  }).catch((e) => logger.error('setPeerMedia failed', { roomId: ctx.roomId, userId: ctx.userId, err: String(e) }));
  if (Boolean(ctx.signal.screen) && !wantsScreen) {
    ctx.handler.sendError(ctx.ws, 'Screen sharing is disabled by the host');
  }
  ctx.handler.publish(ctx.roomId, {
    ...ctx.signal,
    screen: wantsScreen,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

const handleActiveSpeaker: MessageHandler = async (ctx) => {
  const rateLimitKey = `ratelimit:speaker:${ctx.roomId}:${ctx.userId}`;
  const rateLimitResult = await redis.set(rateLimitKey, '1', { ex: 2, nx: true });
  if (!rateLimitResult) return;
  await setActiveSpeaker(ctx.roomId, ctx.userId);
  await publishSignal(ctx.roomId, {
    type: 'active_speaker',
    participantId: ctx.userId,
  });
};

const handleAudioActivity: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

// ── Admin ────────────────────────────────────────────────────────

const handleAdminMuteAll: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  await setForceMuted(ctx.roomId, true);
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_mute_all',
    from: ctx.userId,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'mute_all' });
};

const handleAdminUnmuteAll: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  await setForceMuted(ctx.roomId, false);
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_unmute_all',
    from: ctx.userId,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'unmute_all' });
};

const handleAdminLock: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const locked = Boolean(ctx.signal.locked);
  await setRoomLocked(ctx.roomId, locked);
  await db.update(rooms).set({ isLocked: locked }).where(eq(rooms.id, ctx.roomId));
  ctx.handler.publish(ctx.roomId, { type: 'room_locked', locked, roomId: ctx.roomId });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'lock' });
};

const handleAdminReactionsToggle: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const enabled = Boolean(ctx.signal.enabled);
  await setRoomReactionsEnabled(ctx.roomId, enabled);
  await db
    .update(roomSettings)
    .set({ reactionsEnabled: enabled })
    .where(eq(roomSettings.roomId, ctx.roomId));
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_reactions_toggle',
    enabled,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'reactions_toggle' });
};

const handleAdminChatToggle: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const enabled = Boolean(ctx.signal.enabled);
  await setRoomSetting(ctx.roomId, 'allowChat', enabled);
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_chat_toggle',
    enabled,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'chat_toggle' });
};

const handleAdminScreenToggle: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const enabled = Boolean(ctx.signal.enabled);
  await setRoomSetting(ctx.roomId, 'allowScreenShare', enabled);
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_screen_toggle',
    enabled,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'screen_toggle' });
};

const handleAdminKick: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const targetId = String(ctx.signal.targetId ?? '');
  if (!targetId) {
    ctx.handler.sendError(ctx.ws, 'Missing target user');
    return;
  }
  const roomMeta = await getRoomMeta(ctx.roomId);
  if (!roomMeta) return;
  if (targetId === roomMeta.hostId) {
    ctx.handler.sendError(ctx.ws, 'Cannot kick the host');
    return;
  }
  await removePeerFromRoom(ctx.roomId, targetId);
  await addToKickedList(ctx.roomId, targetId);
  await publishSignal(ctx.roomId, {
    type: 'kicked',
    targetId,
  });
  const target = ctx.handler.getRoomSocket(ctx.roomId, targetId);
  if (target && ctx.handler.isOpen(target)) {
    target.close(4003);
  }
  ctx.handler.removeFromMap(ctx.roomId, targetId);
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'kick' });
};

const handleAdminPromote: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const promoteTargetId = String(ctx.signal.targetId ?? '');
  if (!promoteTargetId) {
    ctx.handler.sendError(ctx.ws, 'Missing target user');
    return;
  }
  await setPeerRole(ctx.roomId, promoteTargetId, 'co-host');
  await db
    .update(roomParticipants)
    .set({ role: 'co-host' })
    .where(
      and(eq(roomParticipants.roomId, ctx.roomId), eq(roomParticipants.userId, promoteTargetId)),
    );
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_promote',
    targetId: promoteTargetId,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'promote' });
};

const handleAdminPinMessage: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const pinnedMessage = {
    messageId: sanitizeText(String(ctx.signal.id ?? '')).slice(0, 128),
    text: sanitizeText(String(ctx.signal.text ?? '')).slice(0, 500),
    authorName: sanitizeText(String(ctx.signal.authorName ?? '')).slice(0, 120),
  };
  if (!pinnedMessage.messageId || !pinnedMessage.text) {
    ctx.handler.sendError(ctx.ws, 'Invalid pinned message');
    return;
  }
  await setRoomPinnedMessage(ctx.roomId, pinnedMessage);
  await publishSignal(ctx.roomId, {
    type: 'message_pinned',
    message: pinnedMessage,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'pin_message' });
};

const handleAdminMute: MessageHandler = async (ctx) => {
  const muteTargetId = String(ctx.signal.targetId ?? '');
  const allowed = await canPerformAdminAction(ctx.roomId, ctx.userId, 'mute', muteTargetId);
  if (!allowed) {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_mute',
    targetId: muteTargetId,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

// ── Recording ────────────────────────────────────────────────────

const handleRecordingStart: MessageHandler = async (ctx) => {
  const role = await getPeerRole(ctx.roomId, ctx.userId);
  if (role !== 'host') {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  const sessionId = await ctx.handler.startRoomRecording(ctx.roomId, ctx.userId);
  if (sessionId === null) {
    ctx.handler.sendError(ctx.ws, 'Already recording');
    return;
  }
};

const handleRecordingStop: MessageHandler = async (ctx) => {
  const role = await getPeerRole(ctx.roomId, ctx.userId);
  if (role !== 'host') {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  const stopped = await ctx.handler.stopRoomRecording(ctx.roomId);
  if (!stopped) {
    ctx.handler.sendError(ctx.ws, 'Not recording');
    return;
  }
};

// ── Misc ─────────────────────────────────────────────────────────

const handleHandRaise: MessageHandler = async (ctx) => {
  const targetId = ctx.signal.targetUserId ? String(ctx.signal.targetUserId) : undefined;
  const raised = Boolean(ctx.signal.raised);
  if (targetId) {
    const role = await getPeerRole(ctx.roomId, ctx.userId);
    if (role !== 'host' && role !== 'co-host') {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    await setHandRaised(ctx.roomId, targetId, raised);
    ctx.handler.publish(ctx.roomId, {
      type: 'hand_raise',
      raised,
      from: targetId,
      roomId: ctx.roomId,
      timestamp: raised ? Date.now() : null,
    });
    return;
  }
  await setHandRaised(ctx.roomId, ctx.userId, raised);
  ctx.handler.publish(ctx.roomId, {
    type: 'hand_raise',
    raised,
    from: ctx.userId,
    roomId: ctx.roomId,
    timestamp: raised ? Date.now() : null,
  });
};

const handleWaiting: MessageHandler = async (ctx) => {
  const role = await getPeerRole(ctx.roomId, ctx.userId);
  if (role !== 'host' && role !== 'co-host') {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  const waitingUserId = String(ctx.signal.userId ?? '');
  if (!waitingUserId) return;
  await removeFromWaitingRoom(ctx.roomId, waitingUserId);
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

// ── Registry ─────────────────────────────────────────────────────

export const handlerRegistry = new Map<string, MessageHandler>([
  // WebRTC
  ['offer', handleOffer],
  ['answer', handleAnswer],
  ['ice', handleIce],
  ['ping', handlePing],
  // Chat
  ['chat', handleChat],
  ['chat_pin', handleChatPin],
  ['chat_reaction', handleChatReaction],
  ['reaction', handleReaction],
  ['caption', handleCaption],
  // Media
  ['media-state', handleMediaState],
  ['active_speaker', handleActiveSpeaker],
  ['audio-activity', handleAudioActivity],
  // Admin
  ['admin_mute_all', handleAdminMuteAll],
  ['admin_unmute_all', handleAdminUnmuteAll],
  ['admin_lock', handleAdminLock],
  ['room_locked', handleAdminLock],
  ['admin_reactions_toggle', handleAdminReactionsToggle],
  ['admin_chat_toggle', handleAdminChatToggle],
  ['admin_screen_toggle', handleAdminScreenToggle],
  ['admin_kick', handleAdminKick],
  ['admin_promote', handleAdminPromote],
  ['admin_pin_message', handleAdminPinMessage],
  ['admin_mute', handleAdminMute],
  // Recording
  ['recording_start', handleRecordingStart],
  ['recording_stop', handleRecordingStop],
  // Misc
  ['hand_raise', handleHandRaise],
  ['waiting', handleWaiting],
]);
