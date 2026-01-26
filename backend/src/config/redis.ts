import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL);

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  await redis.zremrangebyscore(key, 0, windowStart);

  const currentCount = await redis.zcard(key);

  if (currentCount >= maxRequests) {
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const resetIn =
      oldest.length >= 2
        ? Math.max(0, parseInt(oldest[1]) + windowSeconds - now)
        : windowSeconds;

    return { allowed: false, remaining: 0, resetIn };
  }

  await redis.zadd(key, now, `${now}-${Math.random()}`);
  await redis.expire(key, windowSeconds);

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetIn: windowSeconds,
  };
}

export const OTP_RATE_LIMIT_KEY_PREFIX = "otp_rate_limit:";
export const OTP_MAX_REQUESTS_PER_HOUR = 3;
export const OTP_RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds

export async function checkOtpRateLimit(email: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  const key = `${OTP_RATE_LIMIT_KEY_PREFIX}${email.toLowerCase()}`;
  return checkRateLimit(key, OTP_MAX_REQUESTS_PER_HOUR, OTP_RATE_LIMIT_WINDOW);
}

export async function setSession(
  sessionId: string,
  data: object,
  expirySeconds: number,
): Promise<void> {
  await redis.set(
    `session:${sessionId}`,
    JSON.stringify(data),
    "EX",
    expirySeconds,
  );
}

export async function getSession<T>(sessionId: string): Promise<T | null> {
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}
