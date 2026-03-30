import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { redis } from '../config/redis.js';

const PREFIX = 'rl:';

export function createRedisStore(): Store {
  let windowMs = 60000;
  let limit = 100;

  return {
    init(options: Options): void {
      windowMs = options.windowMs ?? 60000;
      limit = typeof options.limit === 'function' ? 100 : (options.limit ?? 100);
    },

    async increment(key: string): Promise<ClientRateLimitInfo> {
      const k = PREFIX + key;
      const windowSec = Math.ceil(windowMs / 1000);
      const multi = redis.multi();
      multi.incr(k);
      multi.pttl(k);
      const results = await multi.exec();
      if (!results) {
        return { totalHits: 1, resetTime: new Date(Date.now() + windowMs) };
      }
      const [, incrResult] = results[0];
      const [, ttlResult] = results[1];
      const totalHits =
        typeof incrResult === 'number' ? incrResult : parseInt(String(incrResult), 10);
      const ttl = typeof ttlResult === 'number' ? ttlResult : parseInt(String(ttlResult), 10);
      if (ttl === -1) {
        await redis.pexpire(k, windowMs);
      }
      const resetTime = ttl > 0 ? new Date(Date.now() + ttl) : new Date(Date.now() + windowMs);
      return { totalHits, resetTime };
    },

    async decrement(key: string): Promise<void> {
      const k = PREFIX + key;
      const v = await redis.decr(k);
      if (v !== undefined && v <= 0) {
        await redis.del(k);
      }
    },

    async resetKey(key: string): Promise<void> {
      await redis.del(PREFIX + key);
    },
  };
}
