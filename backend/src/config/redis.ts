import { Redis } from '@upstash/redis';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Free-tier note: Upstash Redis (REST) has a generous free tier and is the only
 * Redis this app needs on Render's free plan. It is required for room state,
 * sessions, and rate limiting — but the client is constructed lazily so a
 * missing/misconfigured env produces a clear runtime error instead of an
 * import-time crash. `REDIS_URL` (TCP, BullMQ) is a separate optional concern,
 * see `jobs/account-jobs.ts`.
 */
export const isRedisConfigured = Boolean(REST_URL && REST_TOKEN);

if (!isRedisConfigured) {
  console.warn(
    '[Redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set. ' +
      'Set them from your free Upstash instance (docs/FREE_TIER_DEPLOY.md).',
  );
}

let client: Redis | null = null;

function getClient(): Redis {
  if (!isRedisConfigured) {
    throw new Error(
      'Upstash Redis is not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing)',
    );
  }
  if (!client) {
    client = new Redis({
      url: REST_URL!,
      token: REST_TOKEN!,
      enableAutoPipelining: true,
    });
  }
  return client;
}

/**
 * Same `redis.xxx()` API as before, but construction is deferred to first use
 * so the server can boot (and `/health` can report) even when Redis env is
 * missing. Request paths that need Redis will throw a descriptive error.
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const c = getClient() as unknown as Record<PropertyKey, unknown>;
    const value = c[prop];
    return typeof value === 'function' ? (value as (...a: never[]) => unknown).bind(c) : value;
  },
});

let redisSub: Redis | null = null;

export function getRedisSub(): Redis | null {
  if (redisSub) return redisSub;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[Redis] UPSTASH credentials not set, pub/sub disabled');
    return null;
  }
  redisSub = new Redis({ url, token });
  return redisSub;
}

const REFRESH_SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function userSessionKey(userId: string): string {
  return `user:${userId}:session`;
}

function userSessionInvalidBeforeKey(userId: string): string {
  return `user:${userId}:session:invalid_before`;
}

export async function setRefreshSession(userId: string, tokenHash: string): Promise<void> {
  await redis.set(userSessionKey(userId), tokenHash, { ex: REFRESH_SESSION_TTL_SEC });
}

export async function getRefreshSession(userId: string): Promise<string | null> {
  return redis.get<string>(userSessionKey(userId));
}

export async function deleteRefreshSession(userId: string): Promise<void> {
  await redis.del(userSessionKey(userId));
}

export async function getUserSessionInvalidBefore(userId: string): Promise<number | null> {
  const raw = await redis.get<string>(userSessionInvalidBeforeKey(userId));
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
