import { Router, Request, Response } from 'express';
import { requireUser } from '../middleware/auth';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { meetingNotes, transcriptSegments } from '../db/schema';
import { canAccessRoom } from '../lib/room-access';
import { roomSignalChannel } from '../lib/redis-rooms';
import { generateMeetingNotes, type MeetingNotes } from '../lib/meeting-notes';
import { redis } from '../config/redis';
import { logger } from '../lib/logger';

const router = Router();

const MAX_TRANSCRIPT_FETCH = 2000;
const MAX_SCREENSHOTS = 12;

/** Persisted live transcript (newest-last), feeding Ask and notes generation. */
router.get('/:roomId/transcript', async (req: Request<{ roomId: string }>, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const authUser = requireUser(req, res);
    if (!authUser) return;
    if (!(await canAccessRoom(roomId, authUser.id, res))) return;
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(2000, Math.max(1, Math.floor(rawLimit)))
      : 1000;
    const rows = await db
      .select({
        id: transcriptSegments.id,
        userId: transcriptSegments.userId,
        text: transcriptSegments.text,
        occurredAt: transcriptSegments.occurredAt,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.roomId, roomId))
      .orderBy(desc(transcriptSegments.occurredAt), desc(transcriptSegments.id))
      .limit(limit);
    res.json({ segments: [...rows].reverse() });
  } catch (error) {
    logger.error('[Transcript Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Latest generated notes for the room, or null. */
router.get('/:roomId/notes', async (req: Request<{ roomId: string }>, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;
    const authUser = requireUser(req, res);
    if (!authUser) return;
    if (!(await canAccessRoom(roomId, authUser.id, res))) return;
    const [latest] = await db
      .select()
      .from(meetingNotes)
      .where(eq(meetingNotes.roomId, roomId))
      .orderBy(desc(meetingNotes.createdAt))
      .limit(1);
    res.json({ notes: latest ?? null });
  } catch (error) {
    logger.error('[Notes Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

interface ScreenshotRef {
  key: string;
  capturedAt: number;
}

function normalizeScreenshots(raw: unknown): ScreenshotRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreenshotRef[] = [];
  for (const item of raw.slice(0, MAX_SCREENSHOTS)) {
    const s = item as { key?: unknown; capturedAt?: unknown };
    if (typeof s?.key === 'string' && s.key.length > 0 && s.key.length <= 100 && Number.isFinite(s.capturedAt)) {
      out.push({ key: s.key, capturedAt: Math.floor(Number(s.capturedAt)) });
    }
  }
  return out;
}

/**
 * Generate meeting notes from the persisted transcript with the local
 * extractive engine, store them, and push `notes_ready` to the room (and any
 * late clients via GET). Screenshot keys reference per-browser IndexedDB
 * blobs — attendees render their own captured slides.
 */
router.post(
  '/:roomId/notes',
  async (req: Request<{ roomId: string }>, res: Response): Promise<void> => {
    try {
      const { roomId } = req.params;
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      if (!(await canAccessRoom(roomId, userId, res))) return;

      const rows = await db
        .select({ text: transcriptSegments.text })
        .from(transcriptSegments)
        .where(eq(transcriptSegments.roomId, roomId))
        .orderBy(asc(transcriptSegments.occurredAt))
        .limit(MAX_TRANSCRIPT_FETCH);

      const notes: MeetingNotes = generateMeetingNotes(rows.map((r) => r.text));
      const screenshots = normalizeScreenshots(req.body?.screenshots);
      const segmentCount = rows.length;

      if (segmentCount === 0 && screenshots.length === 0) {
        res.status(400).json({
          error: 'No transcript yet — turn on live captions during the meeting',
          code: 'NO_TRANSCRIPT',
        });
        return;
      }

      const [saved] = await db
        .insert(meetingNotes)
        .values({
          roomId,
          createdBy: userId,
          summary: notes.summary,
          actionItems: notes.actionItems,
          decisions: notes.decisions,
          keyPoints: notes.keyPoints,
          screenshots,
          segmentCount,
        })
        .returning();

      await redis
        .publish(
          roomSignalChannel(roomId),
          JSON.stringify({ type: 'notes_ready', notes: saved, from: userId, roomId }),
        )
        .catch(() => {});

      res.status(201).json({ notes: saved });
    } catch (error) {
      logger.error('[Notes Generate Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
