import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
});

export const redisSub = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
});

redis.on('error', (err) => {
  console.error('[Redis]', err.message);
});

redisSub.on('error', (err) => {
  console.error('[Redis Sub]', err.message);
});

const REFRESH_SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export function userSessionKey(userId: string): string {
  return `user:${userId}:session`;
}

export function userSessionInvalidBeforeKey(userId: string): string {
  return `user:${userId}:session:invalid_before`;
}

export function blocklistKey(tokenOrJti: string): string {
  return `blocklist:${tokenOrJti}`;
}

export async function setRefreshSession(userId: string, tokenHash: string): Promise<void> {
  const key = userSessionKey(userId);
  await redis.set(key, tokenHash, 'EX', REFRESH_SESSION_TTL_SEC);
}

export async function getRefreshSession(userId: string): Promise<string | null> {
  return redis.get(userSessionKey(userId));
}

export async function deleteRefreshSession(userId: string): Promise<void> {
  await redis.del(userSessionKey(userId));
}

export async function setUserSessionInvalidBefore(
  userId: string,
  issuedAtSeconds: number,
): Promise<void> {
  await redis.set(userSessionInvalidBeforeKey(userId), String(issuedAtSeconds));
}

export async function getUserSessionInvalidBefore(
  userId: string,
): Promise<number | null> {
  const raw = await redis.get(userSessionInvalidBeforeKey(userId));
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  await Promise.all([
    deleteRefreshSession(userId),
    setUserSessionInvalidBefore(userId, nowInSeconds),
  ]);
}

export async function addToBlocklist(tokenOrJti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;
  const key = blocklistKey(tokenOrJti);
  await redis.set(key, '1', 'EX', ttlSeconds);
}

export async function isBlocklisted(tokenOrJti: string): Promise<boolean> {
  const key = blocklistKey(tokenOrJti);
  const v = await redis.get(key);
  return v !== null;
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart);
  pipe.zcard(key);
  const results = await pipe.exec();
  if (!results) {
    return { allowed: false, remaining: 0, resetIn: windowSeconds };
  }
  const [, count] = results[1];
  const currentCount = typeof count === 'number' ? count : parseInt(String(count), 10);

  if (currentCount >= maxRequests) {
    const ttlResult = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const oldest = ttlResult.length ? Math.floor(parseFloat(ttlResult[1])) : now;
    const resetIn = Math.max(0, oldest + windowSeconds - now);
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

export const OTP_RATE_LIMIT_KEY_PREFIX = 'otp_rate_limit:';
export const OTP_MAX_REQUESTS_PER_HOUR = 3;
export const OTP_RATE_LIMIT_WINDOW = 3600;

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
  const key = `session:${sessionId}`;
  await redis.set(key, JSON.stringify(data), 'EX', expirySeconds);
}

export async function getSession<T>(sessionId: string): Promise<T | null> {
  const key = `session:${sessionId}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}
