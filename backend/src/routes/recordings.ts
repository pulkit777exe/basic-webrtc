import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { recordingSessions, recordingTracks } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth';
import { requireVerifiedEmail } from '../middleware/verified-email';
import { verifyRoomToken } from '../utils/jwt';
import { validateId, validateRoomId } from '../utils/validation';
import { redis } from '../config/redis';
import { getMergeQueue } from '../jobs/recording-worker';
import { setRecordingState, getRecordingState, roomRecordingKey } from '../lib/redis-rooms';

const ROOM_TTL_SEC = 24 * 60 * 60;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'recordings';

const router = Router();

const upload = multer({
  limits: { fileSize: 500 * 1024 * 1024 },
  storage: multer.memoryStorage(),
});

router.post(
  '/chunk',
  upload.single('chunk'),
  async (req: Request, res: Response): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const body = req.body as Record<string, string | undefined>;
    const roomId = (q.roomId ?? body.roomId)?.trim();
    const participantId = (q.participantId ?? body.participantId)?.trim();
    const sessionId = (q.sessionId ?? body.sessionId)?.trim();
    const chunkIndex = q.chunkIndex ?? body.chunkIndex;
    const totalChunks = q.totalChunks ?? body.totalChunks;
    let lockAcquired = false;

    if (!roomId || !participantId || !sessionId || typeof chunkIndex !== 'string' || typeof totalChunks !== 'string') {
      res.status(400).json({ error: 'Missing required parameters', code: 'MISSING_PARAMETERS' });
      return;
    }

    try {
      const validationRules = [
        {
          value: roomId,
          validator: validateRoomId,
          error: 'Invalid roomId',
          code: 'INVALID_ROOM_ID',
        },
        {
          value: participantId,
          validator: validateId,
          error: 'Invalid participantId',
          code: 'INVALID_PARTICIPANT_ID',
        },
        {
          value: sessionId,
          validator: validateId,
          error: 'Invalid sessionId',
          code: 'INVALID_SESSION_ID',
        },
      ];

      for (const { value, validator, error, code } of validationRules) {
        if (!validator(String(value))) {
          res.status(400).json({ error, code });
          return;
        }
      }

      const chunkIndexNum = parseInt(chunkIndex, 10);
      const totalChunksNum = parseInt(totalChunks, 10);

      if (
        isNaN(chunkIndexNum) ||
        isNaN(totalChunksNum) ||
        totalChunksNum <= 0 ||
        chunkIndexNum < 0 ||
        chunkIndexNum >= totalChunksNum
      ) {
        res.status(400).json({ error: 'Invalid chunk index', code: 'INVALID_CHUNK_INDEX' });
        return;
      }

      const token = req.headers['authorization']?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'Missing token', code: 'MISSING_TOKEN' });
        return;
      }
      const decoded = verifyRoomToken(token);
      if (!decoded || decoded.roomId !== roomId || decoded.userId !== participantId) {
        res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
        return;
      }

      const file = req.file;
      if (!file?.buffer?.length) {
        res.status(400).json({ error: 'Missing chunk file', code: 'MISSING_CHUNK' });
        return;
      }

      const lockKey = `upload:lock:${roomId}:${participantId}`;
      const lock = await redis.set(lockKey, '1', {ex: 30, nx: true});
      if (!lock) {
        res.status(429).json({ error: 'UPLOAD_IN_PROGRESS' });
        return;
      }
      lockAcquired = true;

      const participantDir = path.join(RECORDINGS_DIR, roomId, String(sessionId), participantId);
      await fs.promises.mkdir(participantDir, { recursive: true });
      await fs.promises.writeFile(path.join(participantDir, `chunk_${chunkIndexNum}`), file.buffer);

      const chunkCountKey = `upload:chunks:${roomId}:${participantId}:${sessionId}`;
      let currentCount;
      try {
        currentCount = await redis.incr(chunkCountKey);
        await redis.expire(chunkCountKey, ROOM_TTL_SEC);
      } catch (redisError) {
        console.error('Redis counter error:', redisError);
        await redis.del(lockKey).catch((err) => console.error('Failed to release lock:', err));
        lockAcquired = false;
        res.status(500).json({ error: 'Failed to track chunk count', code: 'REDIS_COUNTER_ERROR' });
        return;
      }

      if (currentCount === totalChunksNum) {
        const participantDir = path.join(RECORDINGS_DIR, roomId, sessionId, participantId);
        const outputPath = path.join(RECORDINGS_DIR, roomId, sessionId, `${participantId}.webm`);

        const missingChunks: number[] = [];
        for (let i = 0; i < totalChunksNum; i++) {
          if (!fs.existsSync(path.join(participantDir, `chunk_${i}`))) {
            missingChunks.push(i);
          }
        }

        if (missingChunks.length > 0) {
          await redis.del(lockKey);
          lockAcquired = false;
          res.status(409).json({
            error: 'Missing chunks before assembly',
            code: 'MISSING_CHUNKS',
            missingChunks,
          });
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for (let i = 0; i < totalChunksNum; i++) {
            const chunkPath = path.join(participantDir, `chunk_${i}`);
            chunks.push(await fs.promises.readFile(chunkPath));
          }

          await fs.promises.writeFile(outputPath, Buffer.concat(chunks));

          for (let i = 0; i < totalChunksNum; i++) {
            const chunkPath = path.join(participantDir, `chunk_${i}`);
            await fs.promises.unlink(chunkPath);
          }
          await fs.promises.rmdir(participantDir);

          await redis.del(chunkCountKey);
        } catch (assemblyError) {
          console.error('Error assembling chunks:', assemblyError);
          await redis.decr(chunkCountKey);
          await redis.del(lockKey);
          lockAcquired = false;
          res.status(500).json({ error: 'Chunk assembly failed', code: 'CHUNK_ASSEMBLY_FAILED' });
          return;
        }

        const recordingState = await getRecordingState(roomId);
        if (recordingState) {
          const updatedStateStr = await redis.eval(
            `
            local current = redis.call('GET', KEYS[1])
            local newState
            if current then
              newState = cjson.decode(current)
            else
              newState = { status = 'idle', uploadedTracks = {} }
            end
            if not newState.uploadedTracks then
              newState.uploadedTracks = {}
            end
            table.insert(newState.uploadedTracks, ARGV[1])
            redis.call('SETEX', KEYS[1], ARGV[2], cjson.encode(newState))
            return cjson.encode(newState)
            `,
            [roomRecordingKey(roomId)],
            [participantId, ROOM_TTL_SEC.toString()],
          );
          const updatedState = JSON.parse(updatedStateStr as string);

          const session = await db
            .select()
            .from(recordingSessions)
            .where(
              and(eq(recordingSessions.roomId, roomId), eq(recordingSessions.sessionId, sessionId)),
            )
            .limit(1);

          if (session.length > 0) {
            await db.insert(recordingTracks).values({
              sessionId: session[0].id,
              participantId,
              status: 'uploaded',
            });

            const participantCount = recordingState.participantCount || 0;
            const mergeThreshold = Math.ceil(participantCount * 0.5);

            if (updatedState.uploadedTracks.length >= mergeThreshold) {
              const tracks = [];
              for (const id of updatedState.uploadedTracks) {
                const offset = await redis.get(`recording:offset:${roomId}:${id}`);
                tracks.push({
                  participantId: id,
                  path: path.join(RECORDINGS_DIR, roomId, String(sessionId), `${id}.webm`),
                  startOffset: parseInt(String(offset) || '0', 10),
                });
              }

              const mergeQueue = getMergeQueue();
              if (mergeQueue) {
                await mergeQueue.add('recording-merge', { roomId, sessionId, tracks });
              }
            }
          }
        }
      }

      await redis.del(lockKey);
      lockAcquired = false;

      res.json({ success: true, chunkIndex: chunkIndexNum });
    } catch (error) {
      console.error('[Recording Chunk Error]', error);
      if (lockAcquired && roomId && participantId) {
        const lockKey = `upload:lock:${roomId}:${participantId}`;
        await redis.del(lockKey).catch(() => {});
      }
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

router.get(
  '/:sessionId/download',
  authenticateToken,
  requireVerifiedEmail,
  async (req: Request<{ sessionId: string }>, res: Response): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const userId = req.user!.id;

      const sessions = await db
        .select()
        .from(recordingSessions)
        .where(eq(recordingSessions.sessionId, sessionId))
        .limit(1);

      if (!sessions.length) {
        res.status(404).json({ error: 'Recording session not found', code: 'SESSION_NOT_FOUND' });
        return;
      }

      const session = sessions[0];

      if (session.startedBy !== userId) {
        res.status(403).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      if (!session.roomId) {
        res.status(404).json({ error: 'Invalid recording session', code: 'INVALID_SESSION' });
        return;
      }

      const isDoneInPostgres = session.status === 'done';

      if (!isDoneInPostgres) {
        const recordingState = await getRecordingState(session.roomId);
        res.status(404).json({
          error: 'NOT_READY',
          status: recordingState?.status || session.status || 'idle',
        });
        return;
      }

      const outputPath = session.outputPath;

      if (!outputPath) {
        res
          .status(500)
          .json({ error: 'Output path missing from session record', code: 'NO_OUTPUT_PATH' });
        return;
      }

      if (!fs.existsSync(outputPath)) {
        res.status(500).json({ error: 'Recording file not found on disk', code: 'FILE_NOT_FOUND' });
        return;
      }

      const stat = fs.statSync(outputPath);
      const fileSize = stat.size;
      const fileName = `meeting-${sessionId}.mp4`;

      const rangeHeader = req.headers['range'];

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;

        res.status(206).set({
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        });

        const fileStream = fs.createReadStream(outputPath, { start, end });
        fileStream.pipe(res);

        fileStream.on('error', (streamErr) => {
          console.error('[Download Stream Error]', streamErr);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error', code: 'STREAM_ERROR' });
          }
        });
      } else {
        res.status(200).set({
          'Accept-Ranges': 'bytes',
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        });

        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);

        fileStream.on('error', (streamErr) => {
          console.error('[Download Stream Error]', streamErr);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Stream error', code: 'STREAM_ERROR' });
          }
        });
      }
    } catch (error) {
      console.error('[Download Recording Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

router.get(
  '/:id/status',
  authenticateToken,
  requireVerifiedEmail,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id: roomId } = req.params;

      const participant = await db
        .select()
        .from(recordingSessions)
        .where(eq(recordingSessions.roomId, roomId))
        .limit(1);

      if (!participant.length) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }

      const recordingState = await getRecordingState(roomId);
      const dbSession = participant[0];

      res.json({
        status: recordingState?.status || dbSession.status || 'idle',
        startedAt: recordingState?.startedAt || dbSession.createdAt,
        participantCount: recordingState?.participantCount,
        uploadedTracks: recordingState?.uploadedTracks || [],
        failedTracks: recordingState?.failedTracks || [],downloadUrl:
          dbSession.status === 'done' ? `/api/recordings/${dbSession.sessionId}/download` : null,
      });
    } catch (error) {
      console.error('[Get Recording Status Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  },
);

export default router;
