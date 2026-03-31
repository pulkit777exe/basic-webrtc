import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';

function createStore(prefix: string): RedisStore {
  const sendCommand = async (...args: string[]) => {
    const cmd = args[0].toUpperCase();
    if (cmd === 'EVALSHA' || cmd === 'EVAL') {
      const scriptOrSha = args[1];
      const numKeys = parseInt(args[2], 10);
      const keys = args.slice(3, 3 + numKeys);
      const evalArgs = args.slice(3 + numKeys);
      if (cmd === 'EVALSHA') {
        try {
          return await redis.evalsha(scriptOrSha, keys, evalArgs);
        } catch (err: any) {
          if (err.message && err.message.includes('NOSCRIPT')) {
            throw err;
          }
          throw err;
        }
      } else {
        return await redis.eval(scriptOrSha, keys, evalArgs);
      }
    }
    if (cmd === 'PTTL') {
      return await redis.pttl(args[1]);
    }
    throw new Error('Unsupported command for Upstash Redis Store: ' + cmd);
  };
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: sendCommand as unknown as (...args: string[]) => Promise<any>,
  });
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
