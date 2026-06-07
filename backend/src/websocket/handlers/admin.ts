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
} from '../../lib/redis-rooms';
import { publishSignal } from '../../lib/redis-streams';
import { requireRole, type MessageHandler } from './types';

export const handleAdminMuteAll: MessageHandler = async (ctx) => {
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

export const handleAdminUnmuteAll: MessageHandler = async (ctx) => {
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

export const handleAdminLock: MessageHandler = async (ctx) => {
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

export const handleRoomLocked: MessageHandler = handleAdminLock;

export const handleAdminReactionsToggle: MessageHandler = async (ctx) => {
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

export const handleAdminKick: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const roomMeta = await getRoomMeta(ctx.roomId);
  if (!roomMeta) {
    return;
  }
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

export const handleAdminPromote: MessageHandler = async (ctx) => {
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

export const handleAdminPinMessage: MessageHandler = async (ctx) => {
  const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
  if (!allowed) {
    ctx.ws.close(4003);
    return;
  }
  const { sanitizeText } = await import('../../utils/sanitize');
  const pinnedMessage = {
    messageId: sanitizeText(String(ctx.signal.id ?? '')).slice(0, 128),
    text: sanitizeText(String(ctx.signal.text ?? '')).slice(0, 500),
    authorName: sanitizeText(String(ctx.signal.authorName ?? '')).slice(0, 120),
  };
  if (!pinnedMessage.messageId || !pinnedMessage.text) {
    ctx.handler.sendError(ctx.ws, 'Invalid pinned message');
    return;
  }
  const { setRoomPinnedMessage: setPinned } = await import('../../lib/redis-rooms');
  await setPinned(ctx.roomId, pinnedMessage);
  await publishSignal(ctx.roomId, {
    type: 'message_pinned',
    message: pinnedMessage,
  });
  ctx.handler.send(ctx.ws, { type: 'ack', action: 'pin_message' });
};

export const handleAdminMute: MessageHandler = async (ctx) => {
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

export const handleAdmin: MessageHandler = async (ctx) => {
  const { sanitizeText } = await import('../../utils/sanitize');
  const action = ctx.signal.action;

  if (action === 'start-recording') {
    const allowed = await requireRole(ctx.roomId, ctx.userId, 'host');
    if (!allowed) {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    const sessionId = await ctx.handler.startRoomRecording(ctx.roomId, ctx.userId);
    if (sessionId === null) {
      ctx.handler.sendError(ctx.ws, 'Already recording');
      return;
    }
    return;
  }
  if (action === 'stop-recording') {
    const allowed = await requireRole(ctx.roomId, ctx.userId, 'host');
    if (!allowed) {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    const stopped = await ctx.handler.stopRoomRecording(ctx.roomId);
    if (!stopped) {
      ctx.handler.sendError(ctx.ws, 'Not recording');
      return;
    }
    return;
  }
  if (action === 'mute-all') {
    const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
    if (!allowed) {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    await setForceMuted(ctx.roomId, true);
    ctx.handler.publish(ctx.roomId, {
      type: 'admin_mute_all',
      from: ctx.userId,
      roomId: ctx.roomId,
    });
    return;
  }
  if (action === 'mute-user' && ctx.signal.targetUserId) {
    const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
    if (!allowed) {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    ctx.handler.publish(ctx.roomId, {
      type: 'admin_mute',
      targetId: ctx.signal.targetUserId,
      from: ctx.userId,
      roomId: ctx.roomId,
    });
    return;
  }
  if (action === 'remove-user' && ctx.signal.targetUserId) {
    const allowed = await requireRole(ctx.roomId, ctx.userId, 'co-host');
    if (!allowed) {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    const roomMeta = await getRoomMeta(ctx.roomId);
    if (!roomMeta) {
      return;
    }
    if (ctx.signal.targetUserId === roomMeta.hostId) {
      ctx.handler.sendError(ctx.ws, 'Cannot kick the host');
      return;
    }
    ctx.handler.publish(ctx.roomId, {
      type: 'admin_kick',
      targetId: ctx.signal.targetUserId,
      from: ctx.userId,
      roomId: ctx.roomId,
    });
    const target = ctx.handler.getRoomSocket(ctx.roomId, ctx.signal.targetUserId);
    if (target && ctx.handler.isOpen(target)) {
      ctx.handler.send(target, { type: 'kicked' });
      target.close();
    }
    ctx.handler.removeFromMap(ctx.roomId, ctx.signal.targetUserId);
    await removePeerFromRoom(ctx.roomId, ctx.signal.targetUserId);
    await addToKickedList(ctx.roomId, ctx.signal.targetUserId);
    return;
  }
  if (action === 'promote' && ctx.signal.targetUserId) {
    const allowed = await requireRole(ctx.roomId, ctx.userId, 'host');
    if (!allowed) {
      ctx.handler.sendError(ctx.ws, 'Unauthorized');
      return;
    }
    await setPeerRole(ctx.roomId, ctx.signal.targetUserId, 'co-host');
    await db
      .update(roomParticipants)
      .set({ role: 'co-host' })
      .where(
        and(eq(roomParticipants.roomId, ctx.roomId), eq(roomParticipants.userId, ctx.signal.targetUserId)),
      );
    ctx.handler.publish(ctx.roomId, {
      type: 'admin_promote',
      targetId: ctx.signal.targetUserId,
      from: ctx.userId,
      roomId: ctx.roomId,
    });
    return;
  }
};
