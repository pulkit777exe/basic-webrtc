import { redis } from '../config/redis.js';

const ROOM_TTL_SEC = 24 * 60 * 60;

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

export type RoomRole = 'host' | 'co-host' | 'participant';

export interface RoomMeta {
  hostId: string;
  title: string;
  isLocked: string;
  maxParticipants: string;
  settings?: string;
}

export async function setRoomMeta(
  roomId: string,
  meta: {
    hostId: string;
    title: string;
    isLocked: boolean;
    maxParticipants: number;
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

export async function addPeerToRoom(
  roomId: string,
  userId: string,
  role: RoomRole,
): Promise<void> {
  const pipe = redis.pipeline();
  pipe.sadd(roomPeersKey(roomId), userId);
  pipe.hset(roomRolesKey(roomId), userId, role);
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

export async function getPeerRole(roomId: string, userId: string): Promise<RoomRole | null> {
  const role = await redis.hget(roomRolesKey(roomId), userId);
  if (!role) return null;
  return role as RoomRole;
}

export async function setPeerRole(roomId: string, userId: string, role: RoomRole): Promise<void> {
  await redis.hset(roomRolesKey(roomId), userId, role);
  await redis.expire(roomRolesKey(roomId), ROOM_TTL_SEC);
}

export async function setPeerMedia(
  roomId: string,
  userId: string,
  media: { video: boolean; audio: boolean; screen: boolean },
): Promise<void> {
  const key = roomMediaKey(roomId);
  await redis.hset(key, userId, JSON.stringify(media));
  await redis.expire(key, ROOM_TTL_SEC);
}

export async function addToWaitingRoom(roomId: string, userId: string): Promise<void> {
  await redis.sadd(waitingKey(roomId), userId);
}

export async function removeFromWaitingRoom(roomId: string, userId: string): Promise<void> {
  await redis.srem(waitingKey(roomId), userId);
}

export async function isInWaitingRoom(roomId: string, userId: string): Promise<boolean> {
  return redis.sismember(waitingKey(roomId), userId).then((n) => n === 1);
}

export async function setRoomLocked(roomId: string, isLocked: boolean): Promise<void> {
  await redis.hset(roomKey(roomId), 'isLocked', isLocked ? '1' : '0');
  await redis.expire(roomKey(roomId), ROOM_TTL_SEC);
}

export async function clearRoomState(roomId: string): Promise<void> {
  const pipe = redis.pipeline();
  pipe.del(roomKey(roomId));
  pipe.del(roomPeersKey(roomId));
  pipe.del(roomRolesKey(roomId));
  pipe.del(roomMediaKey(roomId));
  pipe.del(waitingKey(roomId));
  await pipe.exec();
}

export function roomSignalChannel(roomId: string): string {
  return `room:${roomId}:signal`;
}

export function roomEndedChannel(roomId: string): string {
  return `room:${roomId}:ended`;
}
