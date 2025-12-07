import { Request, Response, NextFunction } from "express";

interface RateLimitStore {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, RateLimitStore>();

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: Request) => string; // Custom key generator
}

/**
 * Rate limiting middleware
 * @param options - Rate limit configuration
 * @returns Express middleware function
 */
export const rateLimit = (options: RateLimitOptions) => {
  const { windowMs, maxRequests, keyGenerator } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Generate key for this request (default: IP address + user ID if available)
    const key =
      keyGenerator?.(req) ||
      `${req.ip}-${(req as any).userId || "anonymous"}`;

    const now = Date.now();
    const record = rateLimitStore.get(key);

    // Clean up expired entries periodically
    if (Math.random() < 0.01) {
      // 1% chance to clean up (avoid doing it on every request)
      for (const [k, v] of rateLimitStore.entries()) {
        if (v.resetTime < now) {
          rateLimitStore.delete(k);
        }
      }
    }

    if (!record || record.resetTime < now) {
      // Create new record or reset expired one
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (record.count >= maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfter.toString());
      return res.status(429).json({
        error: "Too many requests",
        message: `Rate limit exceeded. Please try again after ${retryAfter} seconds.`,
        retryAfter,
      });
    }

    // Increment counter
    record.count++;
    rateLimitStore.set(key, record);

    // Add rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", (maxRequests - record.count).toString());
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(record.resetTime).toISOString()
    );

    next();
  };
};

export const analyticsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  keyGenerator: (req) => {
    // Use sessionId if available, otherwise fall back to IP + userId
    const body = req.body as { sessionId?: string };
    const userId = (req as any).userId;
    return body?.sessionId
      ? `analytics-${body.sessionId}`
      : `analytics-${req.ip}-${userId || "anonymous"}`;
  },
});

