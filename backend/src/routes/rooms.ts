import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { db } from '../db';
import { rooms, users, roomParticipants, roomSettings, messages } from '../db/schema';
import { authenticate, authenticateToken, optionalAuthenticate } from '../middleware/auth';
import { generateRoomId } from '../utils/validation';
import { generateRoomToken, generateWaitingToken } from '../utils/jwt';
import { eq, and, desc, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  setRoomMeta,
  getRoomMeta,
  getRoomPeerCount,
  addToWaitingRoom,
  getWaitingRoom,
  getWaitingRoomCount,
  removeFromWaitingRoom,
  addPeerToRoom,
  getPeerRole,
  clearRoomState,
  isRoomLocked,
  roomEndedChannel,
  roomSignalChannel,
  isKicked,
  getRoomReactionsEnabled,
  isForceMuted,
  getActiveSpeaker,
  type WaitingParticipant,
} from '../lib/redis-rooms';
import { redis } from '../config/redis';
import { verifyRoomToken } from '../utils/jwt';
import { apiLimiter } from '../lib/rate-limiters';
import { verifyAccessToken } from '../utils/jwt';
import { globalLimiter } from '../lib/rate-limiters';

async function resolveCanonicalRoomId(raw: string): Promise<string | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [exact] = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.id, trimmed))
    .limit(1);
  if (exact) return exact.id;
  const [folded] = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(sql`lower(${rooms.id}) = lower(${trimmed})`)
    .limit(1);
  return folded?.id ?? null;
}

const router = Router();
const SALT_ROUNDS = 10;

const captionTranscribeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

router.param('id', async (req, res, next, raw: string) => {
  try {
    const canonical = await resolveCanonicalRoomId(raw);
    if (!canonical) {
      res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
      return;
    }
    req.params.id = canonical;
    next();
  } catch (err) {
    next(err);
  }
});

router.param('roomId', async (req, res, next, raw: string) => {
  try {
    const canonical = await resolveCanonicalRoomId(raw);
    if (!canonical) {
      res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
      return;
    }
    req.params.roomId = canonical;
    next();
  } catch (err) {
    next(err);
  }
});

// Create room

router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const {
      title = 'Meeting',
      isLocked = false,
      passcode,
      maxParticipants = 50,
      waitingRoomEnabled = false,
      muteOnJoin = false,
    } = req.body;

    const roomId = generateRoomId();
    const normalizedTitle = String(title).slice(0, 255) || 'Meeting';
    const normalizedLocked = Boolean(isLocked);
    const normalizedMaxParticipants = Math.min(100, Math.max(1, Number(maxParticipants) || 50));
    const normalizedMuteOnJoin = Boolean(muteOnJoin);
    const normalizedWaitingRoomEnabled = Boolean(waitingRoomEnabled);
    const passcodeHash = passcode ? await bcrypt.hash(String(passcode), SALT_ROUNDS) : null;

    const [createdRoom] = await db
      .insert(rooms)
      .values({
        id: roomId,
        hostId: userId,
        title: normalizedTitle,
        isLocked: normalizedLocked,
        passcodeHash,
        maxParticipants: normalizedMaxParticipants,
      })
      .returning({
        id: rooms.id,
        hostId: rooms.hostId,
        title: rooms.title,
        isLocked: rooms.isLocked,
        maxParticipants: rooms.maxParticipants,
        createdAt: rooms.createdAt,
      });

    await db.insert(roomSettings).values({
      roomId,
      allowScreenShare: true,
      allowChat: true,
      muteOnJoin: normalizedMuteOnJoin,
      waitingRoomEnabled: normalizedWaitingRoomEnabled,
    });

    await db.insert(roomParticipants).values({
      roomId,
      userId,
      role: 'host',
    });

    await setRoomMeta(roomId, {
      hostId: userId,
      title: normalizedTitle,
      isLocked: normalizedLocked,
      maxParticipants: normalizedMaxParticipants,
      reactionsEnabled: true,
      settings: JSON.stringify({
        allowScreenShare: true,
        allowChat: true,
        muteOnJoin: normalizedMuteOnJoin,
        waitingRoomEnabled: normalizedWaitingRoomEnabled,
      }),
    });

    res.status(201).json({
      room: {
        id: createdRoom?.id ?? roomId,
        hostId: createdRoom?.hostId ?? userId,
        title: createdRoom?.title ?? normalizedTitle,
        isLocked: createdRoom?.isLocked ?? normalizedLocked,
        maxParticipants: createdRoom?.maxParticipants ?? normalizedMaxParticipants,
        createdAt: createdRoom?.createdAt?.toISOString?.() ?? new Date().toISOString(),
      },
      hasPasscode: Boolean(passcode),
    });
  } catch (error) {
    console.error('[Create Room Error]', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// Get room

router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
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
        hasPasscode: rooms.passcodeHash,
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

    res.json({
      room: {
        ...room,
        participantCount,
        hasPasscode: Boolean(room.hasPasscode),
      },
    });
  } catch (error) {
    console.error('[Get Room Error]', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// Delete room

router.delete(
  '/:id',
  authenticateToken,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const [room] = await db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, id), eq(rooms.hostId, userId)))
        .limit(1);

      if (!room) {
        res.status(404).json({
          error: 'Room not found or unauthorized',
          code: 'ROOM_NOT_FOUND',
        });
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
  },
);

// Join room

router.post(
  '/:id/join',
  authenticateToken,
  async (
    req: Request<{ id: string }, unknown, { passcode?: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const { passcode } = req.body;
      const ip = req.ip || 'unknown';

      // 1. Fetch room from PostgreSQL
      const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
      if (!room) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }

      // 2. Check room.endedAt
      if (room.endedAt) {
        res.status(410).json({ error: 'Room has ended', code: 'ROOM_ENDED' });
        return;
      }

      // 3. Check isRoomLocked (skip for the host)
      const locked = await isRoomLocked(id);
      if (locked && userId !== room.hostId) {
        res.status(423).json({ error: 'Room is locked by the host', code: 'ROOM_LOCKED' });
        return;
      }

      // 4. Check isKicked
      if (await isKicked(id, userId)) {
        res.status(403).json({
          error: 'You have been kicked from this room',
          code: 'KICKED',
        });
        return;
      }

      // 5. Passcode check (skip for the host or invite bypass)
      // Server-side derivation: bypass if user is host OR has valid Redis invite bypass token
      // The Redis token is set when user accesses the invite link while authenticated
      // Host bypass: Room hosts skip passcode check automatically (userId === room.hostId)
      // Invite bypass: Authenticated users who accessed a valid invite link skip passcode AND waiting room
      const bypassKey = `invite:bypass:${userId}:${id}`;
      // Use GETDEL for atomic check-and-delete to prevent race conditions and ensure single-use
      const bypassValue = await redis.getdel(bypassKey);
      const shouldBypass = userId === room.hostId || bypassValue === '1';

      // Audit logging for bypass attempts
      if (shouldBypass) {
        console.info(
          '[BYPASS GRANTED] userId=%s roomId=%s reason=%s ip=%s timestamp=%s',
          userId,
          id,
          userId === room.hostId ? 'host' : 'invite_token',
          ip,
          new Date().toISOString(),
        );
      } else {
        console.info(
          '[BYPASS DENIED] userId=%s roomId=%s reason=key_not_found ip=%s timestamp=%s',
          userId,
          id,
          ip,
          new Date().toISOString(),
        );
      }

      if (room.passcodeHash && !shouldBypass) {
        if (!passcode) {
          res.status(401).json({ error: 'Passcode required', code: 'PASSCODE_REQUIRED' });
          return;
        }

        const attemptsKey = `passcode:attempts:${id}:${ip}`;
        const attempts = await redis.incr(attemptsKey);
        if (attempts === 1) {
          await redis.expire(attemptsKey, 300);
        }
        if (attempts > 5) {
          res.status(429).json({
            error: 'Too many failed attempts',
            code: 'TOO_MANY_ATTEMPTS',
          });
          return;
        }

        const valid = await bcrypt.compare(String(passcode), room.passcodeHash);
        if (!valid) {
          res.status(401).json({ error: 'Invalid passcode', code: 'INVALID_PASSCODE' });
          return;
        }

        // Successfully validated passcode, delete rate limit key
        await redis.del(attemptsKey);
      }

      // 6. Waiting room check (needs settings + user details)
      // Skip if user is host OR has valid invite bypass token
      const [settings] = await db
        .select()
        .from(roomSettings)
        .where(eq(roomSettings.roomId, id))
        .limit(1);

      if (!shouldBypass && settings?.waitingRoomEnabled && room.hostId !== userId) {
        // Fetch user details for the waiting room display
        const [waitingUser] = await db
          .select({
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const joinedAt = new Date().toISOString();
        const participant: WaitingParticipant = {
          id: userId,
          name: waitingUser?.name ?? 'Unknown',
          avatarUrl: waitingUser?.avatarUrl ?? undefined,
          joinedAt,
        };

        await addToWaitingRoom(id, participant);
        const position = await getWaitingRoomCount(id);

        // Notify host(s) currently in the room via pub/sub
        await redis.publish(
          roomSignalChannel(id),
          JSON.stringify({
            type: 'waiting_room_join',
            participant,
            roomId: id,
          }),
        );

        // Generate a short-lived waiting token so the participant can open a WS connection
        const waitingToken = generateWaitingToken(userId, id);
        res.status(202).json({ status: 'waiting', position, waitingToken });
        return;
      }

      // 7. Capacity check
      const count = await getRoomPeerCount(id);
      if (count >= room.maxParticipants) {
        res.status(429).json({ error: 'Room is full', code: 'ROOM_FULL' });
        return;
      }

      // 8. Pre-register role in Redis so the WS getPeerRole check passes, then return token
      const userRole = room.hostId === userId ? 'host' : 'participant';
      await addPeerToRoom(id, userId, userRole);
      const roomToken = generateRoomToken(userId, id);
      res.json({ status: 'joined', roomToken });
    } catch (error) {
      console.error('[Join Room Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Room state

router.get('/:id/state', authenticateToken, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [room] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
    if (!room) {
      res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
      return;
    }

    const [settings] = await db
      .select()
      .from(roomSettings)
      .where(eq(roomSettings.roomId, id))
      .limit(1);

    const [redisMeta, reactionsEnabled, forceMuted, activeSpeaker, participantCount] =
      await Promise.all([
        getRoomMeta(id),
        getRoomReactionsEnabled(id),
        isForceMuted(id),
        getActiveSpeaker(id),
        getRoomPeerCount(id),
      ]);

    const pinnedMessage = redisMeta?.pinnedMessage ? JSON.parse(redisMeta.pinnedMessage) : null;

    res.json({
      pinnedMessage,
      reactionsEnabled,
      locked: redisMeta?.isLocked === '1' || room.isLocked,
      forceMuted,
      activeSpeaker,
      participantCount,
    });
  } catch (error) {
    console.error('[Get Room State Error]', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// Room messages

router.get(
  '/:id/messages',
  async (
    req: Request<{ id: string }, unknown, unknown, { token?: string | string[] }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const authHeader = req.headers.authorization;
      const queryToken = req.query.token;
      const tokenFromQuery = typeof queryToken === 'string' ? queryToken : undefined;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : tokenFromQuery;

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
  },
);

// Waiting room: list

router.get(
  '/:id/waiting-room',
  authenticateToken,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id: roomId } = req.params;
      const userId = req.user!.id;

      const role = await getPeerRole(roomId, userId);
      if (role !== 'host' && role !== 'co-host') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }

      const waitingRoom = await getWaitingRoom(roomId);
      res.json({ waitingRoom });
    } catch (error) {
      console.error('[Waiting Room List Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Waiting room: admit one

router.post(
  '/:id/waiting-room/admit',
  authenticateToken,
  async (
    req: Request<{ id: string }, unknown, { participantId: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { id: roomId } = req.params;
      const userId = req.user!.id;
      const { participantId } = req.body;

      if (!participantId || typeof participantId !== 'string') {
        res.status(400).json({ error: 'participantId required', code: 'BAD_REQUEST' });
        return;
      }

      const role = await getPeerRole(roomId, userId);
      if (role !== 'host' && role !== 'co-host') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }

      // Remove from waiting queue
      await removeFromWaitingRoom(roomId, participantId);

      // Pre-register role in Redis so the participant's WS getPeerRole check passes
      await addPeerToRoom(roomId, participantId, 'participant');

      // Record admit result for the 10-second status-check fallback
      await redis.set(`room:${roomId}:admitResult:${participantId}`, 'admitted', { ex: 300 });

      // Generate room token and push to participant's waiting WS connection
      const roomToken = generateRoomToken(participantId, roomId);
      await redis.publish(
        roomSignalChannel(roomId),
        JSON.stringify({
          type: 'participant_admitted',
          to: participantId,
          participantId,
          roomToken,
          roomId,
        }),
      );

      // Broadcast updated waiting list to all room participants (host sees badge update)
      const waitingRoom = await getWaitingRoom(roomId);
      await redis.publish(
        roomSignalChannel(roomId),
        JSON.stringify({ type: 'waiting_room_update', waitingRoom, roomId }),
      );

      // Persist to DB (best-effort audit log)
      db.insert(roomParticipants)
        .values({ roomId, userId: participantId, role: 'participant' })
        .catch(() => {});

      res.json({ success: true });
    } catch (error) {
      console.error('[Admit Participant Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Waiting room: reject one

router.post(
  '/:id/waiting-room/reject',
  authenticateToken,
  async (
    req: Request<{ id: string }, unknown, { participantId: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { id: roomId } = req.params;
      const userId = req.user!.id;
      const { participantId } = req.body;

      if (!participantId || typeof participantId !== 'string') {
        res.status(400).json({ error: 'participantId required', code: 'BAD_REQUEST' });
        return;
      }

      const role = await getPeerRole(roomId, userId);
      if (role !== 'host' && role !== 'co-host') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }

      await removeFromWaitingRoom(roomId, participantId);

      // Record reject result for the status-check fallback
      await redis.set(`room:${roomId}:admitResult:${participantId}`, 'rejected', { ex: 300 });

      // Push rejection notification to participant's waiting WS
      await redis.publish(
        roomSignalChannel(roomId),
        JSON.stringify({
          type: 'participant_rejected',
          to: participantId,
          participantId,
          roomId,
        }),
      );

      // Broadcast updated waiting list
      const waitingRoom = await getWaitingRoom(roomId);
      await redis.publish(
        roomSignalChannel(roomId),
        JSON.stringify({ type: 'waiting_room_update', waitingRoom, roomId }),
      );

      res.json({ success: true });
    } catch (error) {
      console.error('[Reject Participant Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Waiting room: admit all (host only)

router.post(
  '/:id/waiting-room/admit-all',
  authenticateToken,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id: roomId } = req.params;
      const userId = req.user!.id;

      const role = await getPeerRole(roomId, userId);
      if (role !== 'host') {
        res.status(403).json({ error: 'Only the host can admit all', code: 'FORBIDDEN' });
        return;
      }

      const waiting = await getWaitingRoom(roomId);
      if (waiting.length === 0) {
        res.json({ success: true, admitted: 0 });
        return;
      }

      // Admit all participants in parallel
      await Promise.all(
        waiting.map(async (p) => {
          await removeFromWaitingRoom(roomId, p.id);
          await addPeerToRoom(roomId, p.id, 'participant');
          await redis.set(`room:${roomId}:admitResult:${p.id}`, 'admitted', { ex: 300 });
          const roomToken = generateRoomToken(p.id, roomId);
          await redis.publish(
            roomSignalChannel(roomId),
            JSON.stringify({
              type: 'participant_admitted',
              to: p.id,
              participantId: p.id,
              roomToken,
              roomId,
            }),
          );
          // Persist audit log entry (best-effort)
          db.insert(roomParticipants)
            .values({ roomId, userId: p.id, role: 'participant' })
            .catch(() => {});
        }),
      );

      // Broadcast empty waiting list to room
      await redis.publish(
        roomSignalChannel(roomId),
        JSON.stringify({
          type: 'waiting_room_update',
          waitingRoom: [],
          roomId,
        }),
      );

      res.json({ success: true, admitted: waiting.length });
    } catch (error) {
      console.error('[Admit All Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Generate invite token (host only)

router.post(
  '/:roomId/invite-token',
  authenticateToken,
  apiLimiter,
  async (
    req: Request<{ roomId: string }, unknown, { previousToken?: string }>,
    res: Response,
  ): Promise<void> => {
    try {
      const { roomId } = req.params;
      const userId = req.user!.id;
      const { previousToken } = req.body || {};

      // Validate room exists and user is host
      const [room] = await db
        .select({ hostId: rooms.hostId })
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .limit(1);

      if (!room) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }

      if (room.hostId !== userId) {
        res
          .status(403)
          .json({ error: 'Only the host can generate invite links', code: 'FORBIDDEN' });
        return;
      }

      // Delete previous token if provided (regenerate case)
      if (previousToken && typeof previousToken === 'string') {
        // Validate format: 64-character hex string (32 bytes)
        // If it does not match, skip deletion entirely without logging — it's either a client error or a different token format
        if (typeof previousToken === 'string' && /^[a-f0-9]{64}$/.test(previousToken)) {
          // Verify the previous token belongs to this room before deletion
          const previousRoomId = await redis.get(`invite:${previousToken}`);
          if (previousRoomId && previousRoomId !== roomId) {
            res
              .status(400)
              .json({ error: 'Token does not belong to this room', code: 'INVALID_TOKEN' });
            return;
          }
          // Wrap deletion with error handling so failures don't abort new token generation
          await redis.del(`invite:${previousToken}`).catch((err) => {
            console.error('[Invite Token Cleanup]', { error: err.message, roomId });
            return 0;
          });
        }
      }

      // Generate 32-byte random hex token
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 86400 * 1000); // 24 hours

      // Store in Redis with 24h expiry
      await redis.set(`invite:${inviteToken}`, roomId, { ex: 86400 });

      const appUrl = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
      const inviteUrl = `${appUrl.replace(/\/$/, '')}/join/${inviteToken}`;

      res.json({
        token: inviteToken,
        inviteUrl,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error('[Generate Invite Token Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Join by invite token (public)

router.get(
  '/join-by-invite/:token',
  globalLimiter,
  optionalAuthenticate,
  async (req: Request<{ token: string }>, res: Response): Promise<void> => {
    try {
      const { token } = req.params;

      // Look up invite token in Redis
      const roomId = await redis.get<string>(`invite:${token}`);

      if (!roomId) {
        res.status(410).json({ error: 'invite_expired', code: 'INVITE_EXPIRED' });
        return;
      }

      // Fetch room from PostgreSQL
      const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);

      if (!room) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }

      if (room.endedAt) {
        res.status(410).json({ error: 'invite_expired', code: 'ROOM_ENDED' });
        return;
      }

      // If user is authenticated (via optionalAuthenticate middleware), set bypass token
      if (req.user) {
        // Set bypass flag for 120 seconds - allows join without passcode or waiting room
        // Server derives bypass state from this Redis key in the join handler
        await redis.set(`invite:bypass:${req.user.id}:${roomId}`, '1', { ex: 120 });
      }

      // Return room info - the actual join will happen after auth on the frontend
      // The frontend will call the normal join endpoint (server will check Redis for bypass)
      const participantCount = await getRoomPeerCount(String(roomId));

      res.json({
        room: {
          id: room.id,
          hostId: room.hostId,
          title: room.title,
          isLocked: room.isLocked,
          maxParticipants: room.maxParticipants,
          participantCount,
          hasPasscode: Boolean(room.passcodeHash),
          createdAt: room.createdAt?.toISOString(),
        },
        inviteValid: true,
      });
    } catch (error) {
      console.error('[Join By Invite Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

// Live captions (optional): OpenAI Whisper — requires OPENAI_API_KEY; client uses room token
router.post(
  '/:id/transcribe',
  apiLimiter,
  captionTranscribeUpload.single('file'),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const roomId = req.params.id;
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = token ? verifyRoomToken(token) : null;
    if (!decoded || decoded.roomId !== roomId) {
      res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
      return;
    }

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: 'Missing audio file', code: 'MISSING_FILE' });
      return;
    }

    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    const deepgramKey = process.env.DEEPGRAM_API_KEY?.trim();
    const explicit = process.env.CAPTION_TRANSCRIBE_PROVIDER?.trim().toLowerCase();
    const provider =
      explicit === 'openai' || explicit === 'deepgram'
        ? explicit
        : openaiKey
          ? 'openai'
          : deepgramKey
            ? 'deepgram'
            : '';

    if (
      !provider ||
      (provider === 'openai' && !openaiKey) ||
      (provider === 'deepgram' && !deepgramKey)
    ) {
      if (!openaiKey && !deepgramKey) {
        res.status(503).json({
          error:
            'Caption transcription is not configured. Set OPENAI_API_KEY and/or DEEPGRAM_API_KEY and optional CAPTION_TRANSCRIBE_PROVIDER=openai|deepgram',
          code: 'TRANSCRIBE_DISABLED',
        });
        return;
      }
      res.status(503).json({
        error: 'Caption transcription provider misconfigured',
        code: 'TRANSCRIBE_DISABLED',
      });
      return;
    }

    try {
      let text = '';

      if (provider === 'deepgram' && deepgramKey) {
        const upstream = await fetch(
          'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Token ${deepgramKey}`,
              'Content-Type': file.mimetype || 'audio/webm',
            },
            body: new Uint8Array(file.buffer),
          },
        );
        if (!upstream.ok) {
          const errText = await upstream.text();
          console.error('[transcribe deepgram]', upstream.status, errText);
          res.status(502).json({ error: 'Transcription failed', code: 'TRANSCRIBE_FAILED' });
          return;
        }
        const json = (await upstream.json()) as {
          results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
        };
        text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
      } else if (openaiKey) {
        const form = new FormData();
        form.append('model', 'whisper-1');
        form.append(
          'file',
          new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'audio/webm' }),
          'chunk.webm',
        );

        const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: form,
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          console.error('[transcribe openai]', upstream.status, errText);
          res.status(502).json({ error: 'Transcription failed', code: 'TRANSCRIBE_FAILED' });
          return;
        }

        const json = (await upstream.json()) as { text?: string };
        text = (json.text ?? '').trim();
      }

      res.json({ text });
    } catch (error) {
      console.error('[transcribe]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

export default router;
