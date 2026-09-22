/**
 * Room feature settings snapshot (chat/screen-share/mute-on-join/…).
 *
 * The authoritative copy lives in `room_settings` (Postgres); a JSON mirror
 * rides in Redis room meta (`meta.settings`) so WS handlers can gate chat and
 * screen-share without a DB round-trip per message. Toggles write both.
 */
import { db } from '../db';
import { roomSettings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getRoomMeta, setRoomMeta } from './redis-rooms';

export interface RoomSettingsSnapshot {
  allowChat: boolean;
  allowScreenShare: boolean;
  muteOnJoin: boolean;
  waitingRoomEnabled: boolean;
  maxRecordingDurationMins: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettingsSnapshot = {
  allowChat: true,
  allowScreenShare: true,
  muteOnJoin: false,
  waitingRoomEnabled: false,
  maxRecordingDurationMins: 120,
};

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Tiny in-process TTL cache. `getRoomSettings` runs on every gated chat and
 * media-state WS message — without this it's one Upstash HGETALL per message
 * (free tier ≈10k commands/day). Writes go through `setRoomSetting`, which
 * refreshes the entry, so toggles stay immediately consistent on the single
 * free-tier instance.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }
}

const SETTINGS_TTL_MS = 5_000;
const settingsCache = new TtlCache<RoomSettingsSnapshot>(SETTINGS_TTL_MS);

/** Drop a room's cached settings (call after writes that bypass `setRoomSetting`). */
export function invalidateRoomSettings(roomId: string): void {
  settingsCache.invalidate(roomId);
}

/** Parse the mirrored settings JSON (or a DB row) into a full snapshot. */
export function parseRoomSettings(raw: unknown): RoomSettingsSnapshot {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const maxMins = Number(obj.maxRecordingDurationMins);
  return {
    allowChat: boolOr(obj.allowChat, DEFAULT_ROOM_SETTINGS.allowChat),
    allowScreenShare: boolOr(obj.allowScreenShare, DEFAULT_ROOM_SETTINGS.allowScreenShare),
    muteOnJoin: boolOr(obj.muteOnJoin, DEFAULT_ROOM_SETTINGS.muteOnJoin),
    waitingRoomEnabled: boolOr(obj.waitingRoomEnabled, DEFAULT_ROOM_SETTINGS.waitingRoomEnabled),
    maxRecordingDurationMins:
      Number.isFinite(maxMins) && maxMins > 0 && maxMins <= 24 * 60
        ? Math.floor(maxMins)
        : DEFAULT_ROOM_SETTINGS.maxRecordingDurationMins,
  };
}

/** Settings snapshot: Redis mirror first (fast path), DB fallback, defaults. */
export async function getRoomSettings(roomId: string): Promise<RoomSettingsSnapshot> {
  const cached = settingsCache.get(roomId);
  if (cached) return { ...cached };
  let snapshot: RoomSettingsSnapshot;
  try {
    const meta = await getRoomMeta(roomId);
    if (meta?.settings) {
      snapshot = parseRoomSettings(JSON.parse(meta.settings));
      settingsCache.set(roomId, snapshot);
      return { ...snapshot };
    }
  } catch {
    // Fall through to the database.
  }
  try {
    const [row] = await db
      .select()
      .from(roomSettings)
      .where(eq(roomSettings.roomId, roomId))
      .limit(1);
    if (row) {
      snapshot = {
        allowChat: row.allowChat,
        allowScreenShare: row.allowScreenShare,
        muteOnJoin: row.muteOnJoin,
        waitingRoomEnabled: row.waitingRoomEnabled,
        maxRecordingDurationMins: row.maxRecordingDurationMins,
      };
      settingsCache.set(roomId, snapshot);
      return { ...snapshot };
    }
  } catch {
    // DB hiccup: fall back to permissive defaults.
  }
  snapshot = { ...DEFAULT_ROOM_SETTINGS };
  settingsCache.set(roomId, snapshot);
  return { ...snapshot };
}

/**
 * Flip one setting: updates Postgres (authoritative) and rewrites the Redis
 * mirror in the same call so WS handlers see the change immediately.
 * Single-instance free tier: no cross-node invalidation needed.
 */
export async function setRoomSetting<K extends keyof RoomSettingsSnapshot>(
  roomId: string,
  key: K,
  value: RoomSettingsSnapshot[K],
): Promise<RoomSettingsSnapshot> {
  await db
    .update(roomSettings)
    .set({ [key]: value } as Partial<RoomSettingsSnapshot>)
    .where(eq(roomSettings.roomId, roomId));

  const current = await getRoomSettings(roomId);
  const next: RoomSettingsSnapshot = { ...current, [key]: value };
  settingsCache.set(roomId, next);

  try {
    const meta = await getRoomMeta(roomId);
    if (meta) {
      await setRoomMeta(roomId, {
        hostId: meta.hostId,
        title: meta.title,
        isLocked: meta.isLocked === '1',
        maxParticipants: Number(meta.maxParticipants) || 0,
        reactionsEnabled:
          meta.reactionsEnabled === undefined ? undefined : meta.reactionsEnabled === '1',
        pinnedMessage: meta.pinnedMessage,
        settings: JSON.stringify(next),
      });
    }
  } catch {
    // Mirror is best-effort; the DB row already landed.
  }
  return next;
}
