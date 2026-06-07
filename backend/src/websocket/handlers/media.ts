import { redis } from '../../config/redis';
import { setPeerMedia, setActiveSpeaker } from '../../lib/redis-rooms';
import { publishSignal } from '../../lib/redis-streams';
import type { MessageHandler } from './types';

export const handleMediaState: MessageHandler = async (ctx) => {
  setPeerMedia(ctx.roomId, ctx.userId, {
    video: ctx.signal.video,
    audio: ctx.signal.audio,
    screen: ctx.signal.screen,
  }).catch(() => {});
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};

export const handleActiveSpeaker: MessageHandler = async (ctx) => {
  const rateLimitKey = `ratelimit:speaker:${ctx.roomId}:${ctx.userId}`;
  const rateLimitResult = await redis.set(rateLimitKey, '1', { ex: 2, nx: true });
  if (!rateLimitResult) {
    return;
  }
  await setActiveSpeaker(ctx.roomId, ctx.userId);
  await publishSignal(ctx.roomId, {
    type: 'active_speaker',
    participantId: ctx.userId,
  });
};

export const handleAudioActivity: MessageHandler = async (ctx) => {
  ctx.handler.publish(ctx.roomId, { ...ctx.signal, from: ctx.userId, roomId: ctx.roomId });
};
