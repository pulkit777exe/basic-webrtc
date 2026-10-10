import { createHash } from 'crypto';
import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import type { Request } from 'express';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from '@upstash/redis';
import { isRedisConfigured, redis } from '../config/redis.js';
import { logger } from './logger.js';

/**
 * Free-tier note: when Upstash Redis is not configured (or a command fails
 * transiently, e.g. during a cold start), limiters degrade to an in-memory
 * store / fail-open instead of 500ing requests. MemoryStore is single-instance
 * only, which matches Render's free plan (one instance). Multi-instance
 * deployments should always set UPSTASH_* so limits are shared.
 */
const FAIL_OPEN_TTL_MS = 60_000;

/**
 * The reply `rate-limit-redis` expects for a command, when Redis is unreachable.
 *
 * The *shape* matters, not just the value: `SCRIPT LOAD` must come back as a
 * string SHA and the EVAL scripts as `[hits, ttlMs]`. The store fires its two
 * script loads as fire-and-forget promises in the constructor, so a
 * wrong-shaped reply throws `TypeError: unexpected reply from redis client`
 * inside a promise nobody awaits — an unhandled rejection, raised at boot while
 * the module graph is still evaluating (before server.ts installs its process
 * handlers), which Bun reports as a crash and exits on. It also made every
 * request fail: `increment()` re-threw the same TypeError into the middleware,
 * so with a dead Upstash hostname the whole API — login included — returned 500.
 */
export function failOpenReply(command: string, args: string[]): unknown {
  switch (command.toUpperCase()) {
    case 'SCRIPT':
      // What `SCRIPT LOAD` returns: the SHA1 of the script body. Computed here
      // so that if Redis comes back, an EVALSHA with this SHA either works or
      // fails NOSCRIPT and triggers a real reload instead of failing forever.
      return createHash('sha1').update(args[2] ?? '').digest('hex');
    case 'EVAL':
    case 'EVALSHA':
      // `[totalHits, timeToExpireMs]` — one hit, a full window left. Counting
      // every request as a first hit is what "fail open" means for a limiter.
      return [1, FAIL_OPEN_TTL_MS];
    case 'PTTL':
      return FAIL_OPEN_TTL_MS;
    case 'DECR':
    case 'DEL':
      return 1;
    default:
      return 1;
  }
}

/**
 * Bridges raw commands from `rate-limit-redis` to the Upstash REST client.
 *
 * Never rejects and never returns a wrong-shaped reply: a Redis hiccup logs a
 * warning and answers with `failOpenReply`. The single exception is NOSCRIPT —
 * Redis is up but has no copy of the Lua yet, and `rate-limit-redis` needs that
 * error to know it should SCRIPT LOAD and retry.
 */
export function createSendCommand(
  prefix: string,
  client: Redis,
): (...args: string[]) => Promise<unknown> {
  return async (...args: string[]) => {
    const cmd = String(args[0]).toUpperCase();
    try {
      if (cmd === 'EVALSHA' || cmd === 'EVAL') {
        const scriptOrSha = args[1];
        const numKeys = parseInt(args[2], 10);
        const keys = args.slice(3, 3 + numKeys);
        const evalArgs = args.slice(3 + numKeys);
        if (cmd === 'EVALSHA') {
          return await client.evalsha(scriptOrSha, keys, evalArgs);
        }
        return await client.eval(scriptOrSha, keys, evalArgs);
      }
      if (cmd === 'SCRIPT' && args[1]?.toUpperCase() === 'LOAD') {
        return await client.scriptLoad(args[2]);
      }
      if (cmd === 'PTTL') {
        return await client.pttl(args[1]);
      }
      if (cmd === 'DECR') {
        return await client.decr(args[1]);
      }
      if (cmd === 'DEL') {
        return await client.del(...args.slice(1));
      }
      throw new Error('Unsupported command for Upstash Redis Store: ' + cmd);
    } catch (err) {
      if (cmd === 'EVALSHA' && String(err).includes('NOSCRIPT')) {
        throw err;
      }
      // Fail open: a Redis hiccup must not take down auth/login on the free tier.
      logger.warn(`[RateLimit:${prefix}] Redis command ${cmd} failed, allowing request`, {
        err: String(err),
      });
      return failOpenReply(cmd, args);
    }
  };
}

function createRedisStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: createSendCommand(prefix, redis) as unknown as (...args: string[]) => Promise<any>,
  });
}

function createStore(prefix: string): RedisStore | MemoryStore {
  if (!isRedisConfigured) {
    logger.warn(
      `[RateLimit:${prefix}] Upstash Redis not configured, using in-memory store (single-instance mode)`,
    );
    return new MemoryStore();
  }
  try {
    return createRedisStore(prefix);
  } catch (err) {
    logger.warn(`[RateLimit:${prefix}] could not create Redis store, using in-memory store`, {
      err: String(err),
    });
    return new MemoryStore();
  }
}

function getRetryAfterSeconds(resetTime?: Date): number {
  if (!resetTime) {
    return 60;
  }
  return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
}

function createLimiter(input: {
  prefix: string;
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
}) {
  return rateLimit({
    windowMs: input.windowMs,
    max: input.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: input.skipSuccessfulRequests ?? false,
    // Belt and braces: a store failure means "no rate limiting", never "no API".
    // A login endpoint that 500s because the counter store is down is strictly
    // worse than one that lets a few extra requests through.
    passOnStoreError: true,
    store: createStore(input.prefix),
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? ''),
    handler: (req, res) => {
      const retryAfter = getRetryAfterSeconds(
        (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime,
      );
      res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        retryAfter,
      });
    },
  });
}

export const globalLimiter = createLimiter({
  prefix: 'global',
  windowMs: 60 * 1000,
  max: 200,
});

export const authLimiter = createLimiter({
  prefix: 'auth',
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
});

export const loginLimiter = createLimiter({
  prefix: 'login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
});

export const passwordResetLimiter = createLimiter({
  prefix: 'password-reset',
  windowMs: 60 * 60 * 1000,
  max: 5,
});

export const otpLimiter = createLimiter({
  prefix: 'otp',
  windowMs: 15 * 60 * 1000,
  max: 10,
});

export const strictLimiter = createLimiter({
  prefix: 'strict',
  windowMs: 60 * 60 * 1000,
  max: 5,
});

export const apiLimiter = createLimiter({
  prefix: 'api',
  windowMs: 60 * 1000,
  max: 120,
});
