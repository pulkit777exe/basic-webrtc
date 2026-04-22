import { redis } from '../config/redis';
import { roomPeersKey, roomRolesKey, roomKey, type RoomMeta } from './redis-rooms';

const SESSION_TTL_SEC = 3600;
const PERSIST_INTERVAL_SEC = 30;

export interface PersistedSession {
  roomId: string;
  participants: string[];
  roles: Record<string, string>;
  meta: RoomMeta | null;
  lastUpdated: number;
  serverId: string;
}

export class SessionPersistence {
  private persistInterval: ReturnType<typeof setInterval> | null = null;
  private serverId: string;

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  async persistRoom(roomId: string): Promise<void> {
    const session = await this.captureRoomState(roomId);
    if (!session) return;

    const key = `session:${roomId}`;
    await redis.setex(key, SESSION_TTL_SEC, JSON.stringify(session));
  }

  async restoreRoom(roomId: string): Promise<PersistedSession | null> {
    const key = `session:${roomId}`;
    const raw = await redis.get<string>(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as PersistedSession;
    } catch {
      return null;
    }
  }

  async getAllPersistedRooms(): Promise<string[]> {
    const cursor = '0';
    const rooms: string[] = [];

    let iter = cursor;
    do {
      // @ts-ignore - Upstash scan API
      const [newCursor, keys] = await redis.scan(iter, { match: 'session:*', count: 100 });
      iter = newCursor as unknown as string;
      if (Array.isArray(keys)) {
        for (const key of keys) {
          const roomId = key.replace('session:', '');
          rooms.push(roomId);
        }
      }
    } while (iter !== '0');

    return rooms;
  }

  async clearRoomSession(roomId: string): Promise<void> {
    await redis.del(`session:${roomId}`);
  }

  async claimSession(roomId: string): Promise<boolean> {
    const key = `session:${roomId}:lock`;
    const result = await redis.set(key, this.serverId, { ex: 30, nx: true });
    return result === 'OK';
  }

  async releaseSession(roomId: string): Promise<void> {
    await redis.del(`session:${roomId}:lock`);
  }

  startPersistLoop(roomIds: () => string[]): void {
    this.persistInterval = setInterval(async () => {
      for (const roomId of roomIds()) {
        try {
          await this.persistRoom(roomId);
        } catch (err) {
          console.error('[SessionPersistence] Persist error', { roomId, err });
        }
      }
    }, PERSIST_INTERVAL_SEC * 1000);
  }

  stopPersistLoop(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
  }

  private async captureRoomState(roomId: string): Promise<PersistedSession | null> {
    const [participants, roles, meta] = await Promise.all([
      redis.smembers(roomPeersKey(roomId)),
      redis.hgetall(roomRolesKey(roomId)),
      redis.hgetall(roomKey(roomId)),
    ]);

    if (participants.length === 0) return null;

    return {
      roomId,
      participants,
      roles,
      meta: meta as unknown as RoomMeta,
      lastUpdated: Date.now(),
      serverId: this.serverId,
    };
  }
}

export async function createSessionPersistence(serverId: string): Promise<SessionPersistence> {
  return new SessionPersistence(serverId);
}