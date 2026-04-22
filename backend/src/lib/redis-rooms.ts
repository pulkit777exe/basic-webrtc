import { redis } from '../config/redis.js';

const ROOM_TTL_SEC = 24 * 60 * 60;
const ACTIVE_SPEAKER_TTL_SEC = 30;

export interface RecordingState {
  status: 'idle' | 'recording' | 'uploading' | 'merging' | 'done' | 'failed';
  startedAt?: string;
  startedBy?: string;
  participantCount?: number;
  uploadedTracks?: string[];
  failedTracks?: string[];
  outputPath?: string;
  sessionId?: string;
}

export function roomParticipantsKey(roomId: string): string {
  return `room:${roomId}:participants`;
}

export function roomLockedKey(roomId: string): string {
  return `room:${roomId}:locked`;
}

export function roomReactionsEnabledKey(roomId: string): string {
  return `room:${roomId}:settings:reactions`;
}

export function roomPinnedMessageKey(roomId: string): string {
  return `room:${roomId}:pinnedMessage`;
}

export function roomActiveSpeakerKey(roomId: string): string {
  return `room:${roomId}:activeSpeaker`;
}

export function roomRecordingKey(roomId: string): string {
  return `room:${roomId}:recording`;
}

export function roomKickedKey(roomId: string): string {
  return `room:${roomId}:kicked`;
}

export function roomForceMutedKey(roomId: string): string {
  return `room:${roomId}:forceMuted`;
}

export function roomKey(roomId: string): string {
  return `room:${roomId}`;
}

export function roomPeersKey(roomId: string): string {
  return `room:${roomId}:peers`;
}

export function roomRolesKey(roomId: string): string {
  return `room:${roomId}:roles`;
}

export function roomMediaKey(roomId: string): string {
  return `room:${roomId}:media`;
}

export function waitingKey(roomId: string): string {
  return `waiting:${roomId}`;
}

export function waitingRoomKey(roomId: string): string {
  return `room:${roomId}:waitingRoom`;
}

export interface WaitingParticipant {
  id: string;
  name: string;
  avatarUrl?: string;
  joinedAt: string;
}

export type RoomRole = 'host' | 'co-host' | 'participant';

export interface RoomMeta {
  hostId: string;
  title: string;
  isLocked: string;
  maxParticipants: string;
  reactionsEnabled?: string;
  pinnedMessage?: string;
  settings?: string;
}

export async function setRoomMeta(
  roomId: string,
  meta: {
    hostId: string;
    title: string;
    isLocked: boolean;
    maxParticipants: number;
    reactionsEnabled?: boolean;
    pinnedMessage?: string;
    settings?: string;
  },
): Promise<void> {
  const key = roomKey(roomId);
  await redis
    .multi()
    .hset(key, {
      hostId: meta.hostId,
      title: meta.title,
      isLocked: meta.isLocked ? '1' : '0',
      maxParticipants: String(meta.maxParticipants),
      ...(meta.reactionsEnabled !== undefined && {
        reactionsEnabled: meta.reactionsEnabled ? '1' : '0',
      }),
      ...(meta.pinnedMessage !== undefined && {
        pinnedMessage: meta.pinnedMessage,
      }),
      ...(meta.settings !== undefined && { settings: meta.settings }),
    })
    .expire(key, ROOM_TTL_SEC)
    .exec();
}

export async function getRoomMeta(roomId: string): Promise<RoomMeta | null> {
  const key = roomKey(roomId);
  const meta = await redis.hgetall(key);
  if (!meta || Object.keys(meta).length === 0) return null;
  return meta as unknown as RoomMeta;
}

export async function getRoomPeerCount(roomId: string): Promise<number> {
  return redis.scard(roomPeersKey(roomId));
}

export async function addPeerToRoom(roomId: string, userId: string, role: RoomRole): Promise<void> {
  const pipe = redis.pipeline();
  pipe.sadd(roomPeersKey(roomId), userId);
  pipe.hset(roomRolesKey(roomId), { [userId]: role });
  pipe.expire(roomPeersKey(roomId), ROOM_TTL_SEC);
  pipe.expire(roomRolesKey(roomId), ROOM_TTL_SEC);
  pipe.expire(roomKey(roomId), ROOM_TTL_SEC);
  await pipe.exec();
}

export async function removePeerFromRoom(roomId: string, userId: string): Promise<void> {
  const pipe = redis.pipeline();
  pipe.srem(roomPeersKey(roomId), userId);
  pipe.hdel(roomRolesKey(roomId), userId);
  pipe.hdel(roomMediaKey(roomId), userId);
  await pipe.exec();
}

export async function addToKickedList(roomId: string, participantId: string): Promise<void> {
  const key = roomKickedKey(roomId);
  await redis.sadd(key, participantId);
  await redis.expire(key, ROOM_TTL_SEC);
}

export async function isKicked(roomId: string, participantId: string): Promise<boolean> {
  const result = await redis.sismember(roomKickedKey(roomId), participantId);
  return result === 1;
}

export async function setForceMuted(roomId: string, muted: boolean): Promise<void> {
  const key = roomForceMutedKey(roomId);
  await redis.setex(key, ROOM_TTL_SEC, muted ? '1' : '0');
}

export async function isForceMuted(roomId: string): Promise<boolean> {
  const value = await redis.get(roomForceMutedKey(roomId));
  return value === '1';
}

export async function setActiveSpeaker(roomId: string, participantId: string): Promise<void> {
  const key = roomActiveSpeakerKey(roomId);
  await redis.setex(key, ACTIVE_SPEAKER_TTL_SEC, participantId);
}

export async function getParticipant(
  roomId: string,
  userId: string,
): Promise<{ role: RoomRole } | null> {
  const role = await getPeerRole(roomId, userId);
  if (!role) return null;
  return { role };
}

export async function getActiveSpeaker(roomId: string): Promise<string | null> {
  return await redis.get(roomActiveSpeakerKey(roomId));
}

export async function setRecordingState(
  roomId: string,
  state: Partial<RecordingState>,
): Promise<void> {
  const key = roomRecordingKey(roomId);
  const current = await redis.get<string>(key);
  let newState: RecordingState;
  if (current) {
    newState = JSON.parse(current);
  } else {
    newState = { status: 'idle' };
  }
  newState = { ...newState, ...state };
  await redis.setex(key, ROOM_TTL_SEC, JSON.stringify(newState));
}

export async function getRecordingState(roomId: string): Promise<RecordingState | null> {
  const value = await redis.get<string>(roomRecordingKey(roomId));
  return value ? JSON.parse(value) : null;
}

export async function refreshParticipantTTL(roomId: string): Promise<void> {
  await redis.expire(roomParticipantsKey(roomId), ROOM_TTL_SEC);
}

export async function deleteAllRoomKeys(roomId: string): Promise<void> {
  let cursor = '0';
  do {
    // @ts-ignore
    const [newCursor, keys] = await redis.scan(cursor, { match: `room:${roomId}:*`, count: 100 });
    cursor = newCursor as unknown as string;
    if (Array.isArray(keys) && keys.length > 0) {
      await redis.del(...(keys as string[]));
    }
  } while (cursor !== '0');
}

export async function getPeerRole(roomId: string, userId: string): Promise<RoomRole | null> {
  const role = await redis.hget(roomRolesKey(roomId), userId);
  if (!role) return null;
  return role as RoomRole;
}

export async function setPeerRole(roomId: string, userId: string, role: RoomRole): Promise<void> {
  await redis.hset(roomRolesKey(roomId), { [userId]: role });
  await redis.expire(roomRolesKey(roomId), ROOM_TTL_SEC);
}

export async function setPeerMedia(
  roomId: string,
  userId: string,
  media: { video: boolean; audio: boolean; screen: boolean },
): Promise<void> {
  const key = roomMediaKey(roomId);
  await redis.hset(key, { [userId]: JSON.stringify(media) });
  await redis.expire(key, ROOM_TTL_SEC);
}

export async function addToWaitingRoom(
  roomId: string,
  participant: WaitingParticipant,
): Promise<void> {
  const key = waitingRoomKey(roomId);
  const score = new Date(participant.joinedAt).getTime();
  await redis.zadd(key, { score, member: JSON.stringify(participant) });
  await redis.expire(key, ROOM_TTL_SEC);
}

export async function getWaitingRoom(roomId: string): Promise<WaitingParticipant[]> {
  const key = waitingRoomKey(roomId);
  const members = (await redis.zrange(key, 0, -1)) as string[];
  return members
    .map((m) => {
      try {
        return JSON.parse(m) as WaitingParticipant;
      } catch {
        return null;
      }
    })
    .filter((p): p is WaitingParticipant => p !== null);
}

export async function removeFromWaitingRoom(roomId: string, participantId: string): Promise<void> {
  const key = waitingRoomKey(roomId);
  const members = (await redis.zrange(key, 0, -1)) as string[];
  const toRemove = members.filter((m) => {
    try {
      return (JSON.parse(m) as WaitingParticipant).id === participantId;
    } catch {
      return false;
    }
  });
  if (toRemove.length > 0) {
    await redis.zrem(key, ...toRemove);
  }
}

export async function isInWaitingRoom(roomId: string, participantId: string): Promise<boolean> {
  const key = waitingRoomKey(roomId);
  const members = (await redis.zrange(key, 0, -1)) as string[];
  return members.some((m) => {
    try {
      return (JSON.parse(m) as WaitingParticipant).id === participantId;
    } catch {
      return false;
    }
  });
}

export async function getWaitingRoomCount(roomId: string): Promise<number> {
  return redis.zcard(waitingRoomKey(roomId));
}

export async function setRoomLocked(roomId: string, isLocked: boolean): Promise<void> {
  await redis.hset(roomKey(roomId), { isLocked: isLocked ? '1' : '0' });
  await redis.expire(roomKey(roomId), ROOM_TTL_SEC);
}

export async function isRoomLocked(roomId: string): Promise<boolean> {
  const value = await redis.hget(roomKey(roomId), 'isLocked');
  return value === '1';
}

export async function setRoomReactionsEnabled(roomId: string, enabled: boolean): Promise<void> {
  const key = roomKey(roomId);
  await redis.hset(key, { reactionsEnabled: enabled ? '1' : '0' });
  await redis.expire(key, ROOM_TTL_SEC);
}

export async function getRoomReactionsEnabled(roomId: string): Promise<boolean> {
  const key = roomKey(roomId);
  const value = await redis.hget<string>(key, 'reactionsEnabled');
  return value !== '0';
}

export async function setRoomPinnedMessage(
  roomId: string,
  pinnedMessage: { messageId: string; text: string; authorName: string } | null,
): Promise<void> {
  const key = roomKey(roomId);
  if (!pinnedMessage) {
    await redis.hdel(key, 'pinnedMessage');
  } else {
    const data: Record<string, string> = { pinnedMessage: JSON.stringify(pinnedMessage) };
    await redis.hset(key, data);
    await redis.expire(key, ROOM_TTL_SEC);
  }
}

export async function getRoomPinnedMessage(
  roomId: string,
): Promise<{ messageId: string; text: string; authorName: string } | null> {
  const key = roomKey(roomId);
  const raw = await redis.hget<string>(key, 'pinnedMessage');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      messageId: string;
      text: string;
      authorName: string;
    };
    return parsed;
  } catch {
    return null;
  }
}

export async function canPerformAdminAction(
  roomId: string,
  actorId: string,
  action: 'mute-all' | 'mute' | 'kick' | 'promote' | 'lock' | 'reactions',
  targetId?: string,
): Promise<boolean> {
  const actorRole = await getPeerRole(roomId, actorId);
  if (actorRole !== 'host' && actorRole !== 'co-host') {
    return false;
  }
  if (
    action === 'lock' ||
    action === 'reactions' ||
    action === 'promote' ||
    action === 'mute-all' ||
    action === 'mute' ||
    action === 'kick'
  ) {
    if (actorRole !== 'host') {
      return false;
    }
  }
  if (!targetId) {
    return true;
  }

  const targetRole = await getPeerRole(roomId, targetId);
  if (!targetRole) return true;
  if (targetRole === 'host') return false;
  if (actorRole === 'co-host' && targetRole === 'co-host') return false;
  return true;
}

export async function clearRoomState(roomId: string): Promise<void> {
  const pipe = redis.pipeline();
  pipe.del(roomKey(roomId));
  pipe.del(roomPeersKey(roomId));
  pipe.del(roomRolesKey(roomId));
  pipe.del(roomMediaKey(roomId));
  pipe.del(waitingKey(roomId));
  pipe.del(waitingRoomKey(roomId));
  await pipe.exec();
}

export function roomSignalChannel(roomId: string): string {
  return `room:${roomId}:signal`;
}

export function roomEndedChannel(roomId: string): string {
  return `room:${roomId}:ended`;
}