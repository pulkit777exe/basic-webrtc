import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { db } from '../db';
import { roomParticipants, rooms } from '../db/schema';
import { logger } from './logger';
import { getPeerRole, type RoomRole } from './redis-rooms';

/**
 * Who may read a room's durable content (chat history, transcript, notes).
 *
 * Access survives the live call: the host, anyone currently connected (Redis
 * peer role), or anyone with a persisted `room_participants` row — so past
 * participants can still open the post-meeting recap. Sends the failure
 * response (404 unknown room, 403 non-member) and returns false in that case.
 */
export async function canAccessRoom(
  roomId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const [room] = await db
    .select({ id: rooms.id, hostId: rooms.hostId })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);
  if (!room) {
    res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
    return false;
  }
  if (room.hostId === userId) return true;
  if (await getPeerRole(roomId, userId)) return true;
  const [member] = await db
    .select({ id: roomParticipants.id })
    .from(roomParticipants)
    .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.userId, userId)))
    .limit(1);
  if (member) return true;
  res.status(403).json({ error: 'Not a room participant', code: 'FORBIDDEN' });
  return false;
}

/**
 * Persist a join so membership outlives the call: the dashboard's
 * "Recent meetings", `GET /recordings/:id/status` and post-meeting history all
 * read `room_participants`, while the Redis peer role dies with the room.
 *
 * Best-effort by design — a DB hiccup must not fail the join, because the Redis
 * peer role already grants access to the live room. Idempotent: a rejoin does
 * not create a second row (the table has no unique constraint on
 * room_id+user_id).
 */
export async function recordRoomMembership(
  roomId: string,
  userId: string,
  role: RoomRole,
): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: roomParticipants.id })
      .from(roomParticipants)
      .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.userId, userId)))
      .limit(1);
    if (existing) return;
    await db.insert(roomParticipants).values({ roomId, userId, role });
  } catch (error) {
    logger.warn('recordRoomMembership failed (live access still works via Redis role)', {
      roomId,
      userId,
      err: error,
    });
  }
}
