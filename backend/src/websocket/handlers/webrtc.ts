import { refreshParticipantTTL } from '../../lib/redis-rooms';
import type { MessageHandler, HandlerContext } from './types';

export const handleOffer: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

export const handleAnswer: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

export const handleIce: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

export const handlePing: MessageHandler = async (ctx) => {
  await refreshParticipantTTL(ctx.roomId);
  ctx.handler.send(ctx.ws, { type: 'pong' });
};
