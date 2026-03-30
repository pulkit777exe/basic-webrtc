import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createRedisStore } from '../lib/redis-rate-limit-store.js';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: 'Too many authentication attempts, please try again later',
    code: 'RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
  skip: (req) =>
    req.path === '/forgot-password' ||
    req.path === '/reset-password' ||
    req.path === '/reset-password/validate' ||
    req.path === '/verify-email' ||
    req.path === '/resend-verification',
  keyGenerator: (req) => ipKeyGenerator(req as unknown as string),
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
  keyGenerator: (req) => {
    const u = (req as { user?: { id: string } }).user;
    return u?.id ?? ipKeyGenerator(req as unknown as string);
  },
});

export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests, please try again later', code: 'RATE_LIMIT' },
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore(),
  keyGenerator: (req) => ipKeyGenerator(req as unknown as string),
});
