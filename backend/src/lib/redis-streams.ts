/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from './logger.js';
import { redis } from '../config/redis.js';

// Upstash Redis client doesn't expose stream methods (xadd, xrange, xtrim) in its type definitions.
// These casts are required until Upstash adds stream command types.
//
// Free-tier note: streams are a best-effort durable log for recording state
// only — real-time fan-out uses pub/sub in `websocket/handler.ts`. Every
// operation here degrades gracefully so a Streams hiccup (or Upstash free-tier
// throughput limit) never breaks recording or signaling.

function streamKey(roomId: string): string {
  return `signals:${roomId}`;
}

export async function publishSignal(roomId: string, signal: object): Promise<string> {
  try {
    const key = streamKey(roomId);
    const payload = JSON.stringify(signal);
    const result = await (redis as any).xadd(key, '*', 'payload', payload);
    if (!result) {
      throw new Error('Failed to publish signal');
    }
    const len = await redis.xlen(key);
    if (len > 500) {
      await (redis as any).xtrim(key, 'MAXLEN', '~', 500);
    }
    return result;
  } catch (err) {
    logger.warn('publishSignal degraded (stream write skipped)', {
      roomId,
      err: String(err),
    });
    return `local-${Date.now()}`;
  }
}