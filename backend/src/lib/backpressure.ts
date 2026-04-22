import { redis } from '../config/redis';

const BACKPRESSURE_TTL_SEC = 30;

export interface BackpressureConfig {
  maxQueueSize: number;
  maxMessageAge: number;
  dropOnFull: boolean;
}

const defaultConfig: BackpressureConfig = {
  maxQueueSize: parseInt(process.env.WS_BACKPRESSURE_MAX_QUEUE || '100'),
  maxMessageAge: parseInt(process.env.WS_BACKPRESSURE_MAX_AGE || '5000'),
  dropOnFull: process.env.WS_BACKPRESSURE_DROP === 'true',
};

export class BackpressureManager {
  private connectionStats: Map<string, { queueSize: number; lastSeen: number }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private config: BackpressureConfig = defaultConfig) {
    this.startCleanup();
  }

  async check(roomId: string, userId: string): Promise<{ allowed: boolean; reason?: string }> {
    const key = `bp:${roomId}:${userId}`;
    const tsKey = `bp:ts:${roomId}:${userId}`;

    const [queueSize, lastSeen] = await Promise.all([
      redis.llen(key),
      redis.get<string>(tsKey),
    ]);

    const now = Date.now();
    const messageAge = lastSeen ? now - (parseInt(lastSeen, 10) || 0) : 0;

    if (queueSize >= this.config.maxQueueSize) {
      if (this.config.dropOnFull) {
        await redis.ltrim(key, -this.config.maxQueueSize, -1);
        return { allowed: true, reason: 'queue_flushed' };
      }
      return { allowed: false, reason: 'queue_full' };
    }

    if (messageAge > this.config.maxMessageAge) {
      if (this.config.dropOnFull) {
        await redis.del(key);
        return { allowed: true, reason: 'old_dropped' };
      }
      return { allowed: false, reason: 'messages_stale' };
    }

    return { allowed: true };
  }

  async enqueue(roomId: string, userId: string, message: object): Promise<void> {
    const key = `bp:${roomId}:${userId}`;
    const payload = JSON.stringify({
      ...message,
      queuedAt: Date.now(),
    });

    await Promise.all([
      redis.rpush(key, payload),
      redis.expire(key, BACKPRESSURE_TTL_SEC),
      redis.set(`bp:ts:${roomId}:${userId}`, String(Date.now()), {
        ex: BACKPRESSURE_TTL_SEC,
      }),
    ]);
  }

  async dequeue(roomId: string, userId: string): Promise<object | null> {
    const key = `bp:${roomId}:${userId}`;
    const payload = await redis.lpop<string>(key);
    if (!payload) return null;

    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  async flush(roomId: string, userId: string): Promise<void> {
    await Promise.all([
      redis.del(`bp:${roomId}:${userId}`),
      redis.del(`bp:ts:${roomId}:${userId}`),
    ]);
  }

  async getStats(roomId: string, userId: string): Promise<{ queueSize: number; oldestMessageAge: number }> {
    const key = `bp:${roomId}:${userId}`;
    const [queueSize, firstTs] = await Promise.all([
      redis.llen(key),
      redis.lindex(key, 0),
    ]);

    let oldestMessageAge = 0;
    if (firstTs) {
      try {
        const parsed = JSON.parse(firstTs);
        oldestMessageAge = Date.now() - (parsed.queuedAt || 0);
      } catch {
        oldestMessageAge = 0;
      }
    }

    return { queueSize, oldestMessageAge };
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const entries = Array.from(this.connectionStats.entries());
      const now = Date.now();

      for (const [key, stats] of entries) {
        if (now - stats.lastSeen > 60000) {
          this.connectionStats.delete(key);
        }
      }
    }, 30000);
  }

  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

export async function applyBackpressure(
  roomId: string,
  userId: string,
  message: object,
  config: BackpressureConfig = defaultConfig,
): Promise<{ allowed: boolean; queued?: boolean }> {
  const bp = new BackpressureManager(config);
  const check = await bp.check(roomId, userId);

  if (!check.allowed) {
    if (check.reason === 'queue_full') {
      await bp.enqueue(roomId, userId, message);
      return { allowed: true, queued: true };
    }
    return { allowed: false };
  }

  return { allowed: true };
}