import { Router, Request, Response } from 'express';
import { db } from '../db';
import {
  rooms,
  users,
  roomParticipants,
  roomSettings,
  messages,
} from '../db/schema';
import { authenticate, authenticateToken } from '../middleware/auth';
import { generateRoomId } from '../utils/validation';
import { generateRoomToken } from '../utils/jwt';
import { eq, and, desc } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  setRoomMeta,
  getRoomMeta,
  getRoomPeerCount,
  addToWaitingRoom,
  clearRoomState,
  roomEndedChannel,
} from '../lib/redis-rooms';
import { redis } from '../config/redis';
import { verifyRoomToken } from '../utils/jwt';

const router = Router();
const SALT_ROUNDS = 10;

router.post(
  '/',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { title = 'Meeting', isLocked = false, passcode, maxParticipants = 50 } = req.body;

      const roomId = generateRoomId();
      const passcodeHash = passcode
        ? await bcrypt.hash(String(passcode), SALT_ROUNDS)
        : null;

      await db.insert(rooms).values({
        id: roomId,
        hostId: userId,
        title: String(title).slice(0, 255) || 'Meeting',
        isLocked: Boolean(isLocked),
        passcodeHash,
        maxParticipants: Math.min(100, Math.max(1, Number(maxParticipants) || 50)),
      });

      await db.insert(roomSettings).values({
        roomId,
        allowScreenShare: true,
        allowChat: true,
        muteOnJoin: false,
        waitingRoomEnabled: false,
      });

      await db.insert(roomParticipants).values({
        roomId,
        userId,
        role: 'host',
      });

      await setRoomMeta(roomId, {
        hostId: userId,
        title: String(title).slice(0, 255) || 'Meeting',
        isLocked: Boolean(isLocked),
        maxParticipants: Math.min(100, Math.max(1, Number(maxParticipants) || 50)),
        settings: JSON.stringify({
          allowScreenShare: true,
          allowChat: true,
          muteOnJoin: false,
          waitingRoomEnabled: false,
        }),
      });

      const [room] = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .limit(1);

      res.status(201).json({ room: { ...room, id: roomId } });
    } catch (error) {
      console.error('[Create Room Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [room] = await db
      .select({
        id: rooms.id,
        hostId: rooms.hostId,
        title: rooms.title,
        isLocked: rooms.isLocked,
        maxParticipants: rooms.maxParticipants,
        createdAt: rooms.createdAt,
        endedAt: rooms.endedAt,
        hostName: users.name,
      })
      .from(rooms)
      .leftJoin(users, eq(rooms.hostId, users.id))
      .where(eq(rooms.id, id))
      .limit(1);

    if (!room) {
      res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
      return;
    }

    if (room.endedAt) {
      res.status(404).json({ error: 'Room has ended', code: 'ROOM_ENDED' });
      return;
    }

    const participantCount = await getRoomPeerCount(id);

    res.json({ room: { ...room, participantCount } });
  } catch (error) {
    console.error('[Get Room Error]', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

router.delete(
  '/:id',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const [room] = await db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, id), eq(rooms.hostId, userId)))
        .limit(1);

      if (!room) {
        res.status(404).json({ error: 'Room not found or unauthorized', code: 'ROOM_NOT_FOUND' });
        return;
      }

      await db.update(rooms).set({ endedAt: new Date() }).where(eq(rooms.id, id));
      await redis.publish(roomEndedChannel(id), JSON.stringify({ roomId: id }));
      await clearRoomState(id);

      res.status(204).send();
    } catch (error) {
      console.error('[Delete Room Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

router.post(
  '/:id/join',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const { passcode } = req.body;

      const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
      if (!room) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }
      if (room.endedAt) {
        res.status(400).json({ error: 'Room has ended', code: 'ROOM_ENDED' });
        return;
      }

      const count = await getRoomPeerCount(id);
      if (count >= room.maxParticipants) {
        res.status(400).json({ error: 'Room is full', code: 'ROOM_FULL' });
        return;
      }

      if (room.passcodeHash) {
        if (!passcode) {
          res.status(400).json({ error: 'Passcode required', code: 'PASSCODE_REQUIRED' });
          return;
        }
        const valid = await bcrypt.compare(String(passcode), room.passcodeHash);
        if (!valid) {
          res.status(403).json({ error: 'Invalid passcode', code: 'INVALID_PASSCODE' });
          return;
        }
      }

      const [settings] = await db
        .select()
        .from(roomSettings)
        .where(eq(roomSettings.roomId, id))
        .limit(1);

      if (settings?.waitingRoomEnabled) {
        await addToWaitingRoom(id, userId);
        res.json({ status: 'waiting' });
        return;
      }

      const roomToken = generateRoomToken(userId, id);
      res.json({ status: 'joined', roomToken });
    } catch (error) {
      console.error('[Join Room Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

router.get(
  '/:id/messages',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token as string;

      const roomPayload = token ? verifyRoomToken(token) : null;
      const userPayload = req.user;

      if (!roomPayload && !userPayload) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      if (roomPayload && roomPayload.roomId !== id) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }

      const list = await db
        .select({
          id: messages.id,
          roomId: messages.roomId,
          userId: messages.userId,
          content: messages.content,
          type: messages.type,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.roomId, id))
        .orderBy(desc(messages.createdAt))
        .limit(50);

      res.json({ messages: list.reverse() });
    } catch (error) {
      console.error('[Get Messages Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

export default router;
