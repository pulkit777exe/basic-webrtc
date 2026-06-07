import { nanoid } from 'nanoid';
import { sanitizeText } from '../../utils/sanitize';
import { setRoomPinnedMessage, getPeerRole } from '../../lib/redis-rooms';
import type { MessageHandler } from './types';

export const handleChat: MessageHandler = async (ctx) => {
  const content = sanitizeText(String(ctx.signal.content ?? '').slice(0, 2000));
  if (!content.trim()) return;
  const entry = {
    roomId: ctx.roomId,
    userId: ctx.userId,
    content,
    timestamp: ctx.signal.timestamp ?? Date.now(),
    id: nanoid(),
  };
  ctx.handler.bufferChat(entry);
  if (ctx.handler.getChatBufferSize() >= ctx.handler.getChatBufferFlushSize()) {
    await ctx.handler.flushChatBuffer();
  }
};

export const handleChatPin: MessageHandler = async (ctx) => {
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

export const handleChatReaction: MessageHandler = async (ctx) => {
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

export const handleCaption: MessageHandler = async (ctx) => {
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
