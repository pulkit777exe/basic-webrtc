import rateLimit, { ipKeyGenerator, MemoryStore } from 'express-rate-limit';
import type { Request } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { isRedisConfigured, redis } from '../config/redis.js';
import { logger } from './logger.js';

/**
 * Free-tier note: when Upstash Redis is not configured (or a command fails
 * transiently, e.g. during a cold start), limiters degrade to an in-memory
 * store / fail-open instead of 500ing requests. MemoryStore is single-instance
 * only, which matches Render's free plan (one instance). Multi-instance
 * deployments should always set UPSTASH_* so limits are shared.
 */
function createRedisStore(prefix: string): RedisStore {
  const sendCommand = async (...args: string[]) => {
    const cmd = args[0].toUpperCase();
    try {
      if (cmd === 'EVALSHA' || cmd === 'EVAL') {
        const scriptOrSha = args[1];
        const numKeys = parseInt(args[2], 10);
        const keys = args.slice(3, 3 + numKeys);
        const evalArgs = args.slice(3 + numKeys);
        if (cmd === 'EVALSHA') {
          try {
            return await redis.evalsha(scriptOrSha, keys, evalArgs);
          } catch (err: unknown) {
            if (err instanceof Error && err.message && err.message.includes('NOSCRIPT')) {
              throw err;
            }
            throw err;
          }
        } else {
          return await redis.eval(scriptOrSha, keys, evalArgs);
        }
      }
      if (cmd === 'SCRIPT') {
        const subcommand = args[1]?.toUpperCase();
        if (subcommand === 'LOAD') {
          return await redis.scriptLoad(args[2]);
        }
      }
      if (cmd === 'PTTL') {
        return await redis.pttl(args[1]);
      }
      if (cmd === 'DECR') {
        return await redis.decr(args[1]);
      }
      if (cmd === 'DEL') {
        return await redis.del(...args.slice(1));
      }
      throw new Error('Unsupported command for Upstash Redis Store: ' + cmd);
    } catch (err) {
      // Fail open: a Redis hiccup must not take down auth/login on the free tier.
      logger.warn(`[RateLimit:${prefix}] Redis command ${cmd} failed, allowing request`, {
        err: String(err),
      });
      if (cmd === 'PTTL') return 60_000;
      if (cmd === 'DECR') return 1;
      if (cmd === 'DEL') return 1;
      // rate-limit-redis EVAL scripts return [totalHits, resetTimeMs]
      return [1, Date.now() + 60_000];
    }
  };
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: sendCommand as unknown as (...args: string[]) => Promise<any>,
  });
}

function createStore(prefix: string): RedisStore | MemoryStore {
  if (!isRedisConfigured) {
    logger.warn(
      `[RateLimit:${prefix}] Upstash Redis not configured, using in-memory store (single-instance mode)`,
    );
    return new MemoryStore();
  }
  return createRedisStore(prefix);
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
