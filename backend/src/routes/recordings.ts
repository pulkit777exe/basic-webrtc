import { Router, Request, Response } from 'express';
import { db } from '../db';
import { recordingSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
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
