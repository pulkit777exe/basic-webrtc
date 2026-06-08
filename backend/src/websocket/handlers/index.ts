import { randomUUID } from 'crypto';
import { db } from '../../db';
import { rooms, roomParticipants, roomSettings } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  setForceMuted,
  setRoomLocked,
  setRoomReactionsEnabled,
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
  const content = sanitizeText(String(ctx.signal.content ?? '').slice(0, 2000));
  if (!content.trim()) return;
  const entry = {
    roomId: ctx.roomId,
    userId: ctx.userId,
    content,
    timestamp: ctx.signal.timestamp ?? Date.now(),
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
  ctx.handler.publish(ctx.roomId, {
    type: 'chat_reaction',
    messageId,
    emoji,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

const handleCaption: MessageHandler = async (ctx) => {
  const text = sanitizeText(String(ctx.signal.text ?? '').slice(0, 2000));
  if (!text.trim()) return;
  ctx.handler.publish(ctx.roomId, {
    type: 'caption',
    text,
    timestamp: ctx.signal.timestamp ?? Date.now(),
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

// ── Media ────────────────────────────────────────────────────────

const handleMediaState: MessageHandler = async (ctx) => {
  setPeerMedia(ctx.roomId, ctx.userId, {
    video: ctx.signal.video,
    audio: ctx.signal.audio,
    screen: ctx.signal.screen,
  }).catch((e) => logger.error('setPeerMedia failed', { roomId: ctx.roomId, userId: ctx.userId, err: String(e) }));
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
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
  const locked = ctx.signal.locked;
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
  await setRoomReactionsEnabled(ctx.roomId, ctx.signal.enabled);
  await db
    .update(roomSettings)
    .set({ reactionsEnabled: ctx.signal.enabled })
    .where(eq(roomSettings.roomId, ctx.roomId));
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_reactions_toggle',
    enabled: ctx.signal.enabled,
    roomId: ctx.roomId,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'reactions_toggle' });
};

const handleAdminKick: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const roomMeta = await getRoomMeta(ctx.roomId);
  if (!roomMeta) return;
  if (ctx.signal.targetId === roomMeta.hostId) {
    ctx.handler.sendError(ctx.ws, 'Cannot kick the host');
    return;
  }
  await removePeerFromRoom(ctx.roomId, ctx.signal.targetId);
  await addToKickedList(ctx.roomId, ctx.signal.targetId);
  await publishSignal(ctx.roomId, {
    type: 'kicked',
    targetId: ctx.signal.targetId,
  });
  const target = ctx.handler.getRoomSocket(ctx.roomId, ctx.signal.targetId);
  if (target && ctx.handler.isOpen(target)) {
    target.close(4003);
  }
  ctx.handler.removeFromMap(ctx.roomId, ctx.signal.targetId);
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'kick' });
};

const handleAdminPromote: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  await setPeerRole(ctx.roomId, ctx.signal.targetId, 'co-host');
  await db
    .update(roomParticipants)
    .set({ role: 'co-host' })
    .where(
      and(eq(roomParticipants.roomId, ctx.roomId), eq(roomParticipants.userId, ctx.signal.targetId)),
    );
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_promote',
    targetId: ctx.signal.targetId,
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
  const allowed = await canPerformAdminAction(ctx.roomId, ctx.userId, 'mute', ctx.signal.targetId);
  if (!allowed) {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  ctx.handler.publish(ctx.roomId, {
    type: 'admin_mute',
    targetId: ctx.signal.targetId,
    from: ctx.userId,
    roomId: ctx.roomId,
  });
};

const handleDeprecatedAdmin: MessageHandler = async (ctx) => {
  logger.warn('Received deprecated admin message type', {
    roomId: ctx.roomId,
    userId: ctx.userId,
    action: ctx.signal.action,
  });
  ctx.handler.sendError(ctx.ws, 'Deprecated message type. Use specific admin actions instead.');
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

const handleRecordingUploadProgress: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

const handleRecordingTrackOffset: MessageHandler = async (ctx) => {
  const offset = ctx.signal.offset;
  if (typeof offset !== 'number' || offset < 0) {
    ctx.handler.sendError(ctx.ws, 'Invalid offset');
    return;
  }
  try {
    await redis.set(`recording:offset:${ctx.roomId}:${ctx.userId}`, offset, { ex: 86400 });
  } catch (error) {
    logger.error('Failed to store recording track offset', {
      roomId: ctx.roomId,
      userId: ctx.userId,
      err: String(error),
    });
    ctx.handler.sendError(ctx.ws, 'Failed to store track offset');
  }
};

// ── Misc ─────────────────────────────────────────────────────────

const handleHandRaise: MessageHandler = async (ctx) => {
  const targetId = ctx.signal.targetUserId;
  if (targetId) {
    const role = await getPeerRole(ctx.roomId, ctx.userId);
    if (role !== 'host' && role !== 'co-host') {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    await setHandRaised(ctx.roomId, targetId, ctx.signal.raised);
    ctx.handler.publish(ctx.roomId, {
      type: 'hand_raise',
      raised: ctx.signal.raised,
      from: targetId,
      roomId: ctx.roomId,
      timestamp: ctx.signal.raised ? Date.now() : null,
    });
    return;
  }
  await setHandRaised(ctx.roomId, ctx.userId, ctx.signal.raised);
  ctx.handler.publish(ctx.roomId, {
    type: 'hand_raise',
    raised: ctx.signal.raised,
    from: ctx.userId,
    roomId: ctx.roomId,
    timestamp: ctx.signal.raised ? Date.now() : null,
  });
};

const handleWaiting: MessageHandler = async (ctx) => {
  const role = await getPeerRole(ctx.roomId, ctx.userId);
  if (role !== 'host' && role !== 'co-host') {
    ctx.handler.sendError(ctx.ws, 'Unauthorized');
    return;
  }
  await removeFromWaitingRoom(ctx.roomId, ctx.signal.userId);
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
  ['admin_kick', handleAdminKick],
  ['admin_promote', handleAdminPromote],
  ['admin_pin_message', handleAdminPinMessage],
  ['admin_mute', handleAdminMute],
  ['admin', handleDeprecatedAdmin],
  // Recording
  ['recording_start', handleRecordingStart],
  ['recording_stop', handleRecordingStop],
  ['recording_upload_progress', handleRecordingUploadProgress],
  ['recording_track_offset', handleRecordingTrackOffset],
  // Misc
  ['hand_raise', handleHandRaise],
  ['waiting', handleWaiting],
]);
