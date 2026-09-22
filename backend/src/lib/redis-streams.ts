import { logger } from './logger.js';
import { redis } from '../config/redis.js';

// Upstash's REST client types don't declare stream commands (xadd/xrange/
// xtrim), so we assert a minimal structural interface for them instead of
// reaching for `any`. Every operation degrades gracefully so a Streams hiccup
// (or the Upstash free-tier throughput limit) never breaks recording or
// signaling — real-time fan-out uses pub/sub in `websocket/handler.ts`.
interface StreamCommands {
  xadd(key: string, ...args: Array<string | number>): Promise<unknown>;
  xtrim(key: string, ...args: Array<string | number>): Promise<unknown>;
  xlen(key: string): Promise<number>;
}

const streamRedis = redis as unknown as StreamCommands;

function streamKey(roomId: string): string {
  return `signals:${roomId}`;
}

export async function publishSignal(roomId: string, signal: object): Promise<string> {
  try {
    const key = streamKey(roomId);
    const payload = JSON.stringify(signal);
    const result = await streamRedis.xadd(key, '*', 'payload', payload);
    if (!result) {
      throw new Error('Failed to publish signal');
    }
    const len = await redis.xlen(key);
    if (len > 500) {
      await streamRedis.xtrim(key, 'MAXLEN', '~', 500);
    }
    return String(result);
  } catch (err) {
    logger.warn('publishSignal degraded (stream write skipped)', {
      roomId,
      err: String(err),
    });
    return `local-${Date.now()}`;
  }
}