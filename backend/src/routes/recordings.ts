import { Router, Request, Response } from 'express';
import { db } from '../db';
import { recordingSessions, rooms, roomParticipants } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth';
import { requireVerifiedEmail } from '../middleware/verified-email';
import { getRecordingState } from '../lib/redis-rooms';

const router = Router();

router.get(
  '/:id/status',
  authenticateToken,
  requireVerifiedEmail,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id: roomId } = req.params;
      const userId = req.user!.id;

      // Only members of the room may read its recording status.
      const [roomRow] = await db
        .select({ hostId: rooms.hostId })
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .limit(1);
      if (roomRow?.hostId !== userId) {
        const [participant] = await db
          .select({ id: roomParticipants.id })
          .from(roomParticipants)
          .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.userId, userId)))
          .limit(1);
        if (!participant) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
          return;
        }
      }

      const sessions = await db
        .select()
        .from(recordingSessions)
        .where(eq(recordingSessions.roomId, roomId))
        .limit(1);

      if (!sessions.length) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }

      const recordingState = await getRecordingState(roomId);
      const dbSession = sessions[0];

      res.json({
        status: recordingState?.status || dbSession.status || 'idle',
        startedAt: recordingState?.startedAt || dbSession.createdAt,
        participantCount: recordingState?.participantCount,
      });
    } catch (error) {
      console.error('[Get Recording Status Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

export default router;
