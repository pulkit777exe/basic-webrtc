import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { recordingSessions, recordingTracks } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth';
import { verifyRoomToken } from '../utils/jwt';
import { validateId, validateRoomId } from '../utils/validation';
import { redis } from '../config/redis';
import { mergeQueue } from '../jobs/recording-worker';
import { setRecordingState, getRecordingState, roomRecordingKey } from '../lib/redis-rooms';

const ROOM_TTL_SEC = 24 * 60 * 60;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'recordings';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const { roomId, sessionId, participantId } = req.body;
      const dir = path.join(RECORDINGS_DIR, roomId, sessionId, participantId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const { chunkIndex } = req.body;
      cb(null, `chunk_${chunkIndex}`);
    },
  }),
});

// POST /api/recordings/chunk
router.post(
  '/chunk',
  authenticateToken,
  upload.single('chunk'),
  async (req: Request, res: Response): Promise<void> => {
    const { roomId, participantId, chunkIndex, totalChunks, sessionId } = req.body;
    let lockAcquired = false;

    try {
      // Validate parameters with appropriate validators and error codes
      const validationRules = [
        { value: roomId, validator: validateRoomId, error: 'Invalid roomId', code: 'INVALID_ROOM_ID' },
        { value: participantId, validator: validateId, error: 'Invalid participantId', code: 'INVALID_PARTICIPANT_ID' },
        { value: sessionId, validator: validateId, error: 'Invalid sessionId', code: 'INVALID_SESSION_ID' }
      ];

      for (const { value, validator, error, code } of validationRules) {
        if (!validator(value)) {
          res.status(400).json({ error, code });
          return;
        }
      }

      const chunkIndexNum = parseInt(chunkIndex, 10);
      const totalChunksNum = parseInt(totalChunks, 10);

      // Validate chunk index
      if (isNaN(chunkIndexNum) || isNaN(totalChunksNum) || totalChunksNum <= 0 || chunkIndexNum < 0 || chunkIndexNum >= totalChunksNum) {
        res.status(400).json({ error: 'Invalid chunk index', code: 'INVALID_CHUNK_INDEX' });
        return;
      }

      // Validate room token matches roomId
      const token = req.headers['authorization']?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'Missing token', code: 'MISSING_TOKEN' });
        return;
      }
      const decoded = verifyRoomToken(token);
      if (!decoded || decoded.roomId !== roomId) {
        res.status(403).json({ error: 'Invalid room token', code: 'INVALID_TOKEN' });
        return;
      }

      // Acquire upload lock in Redis
      const lockKey = `upload:lock:${roomId}:${participantId}`;
      const lock = await redis.set(lockKey, '1', 'EX', 30, 'NX');
      if (!lock) {
        res.status(429).json({ error: 'UPLOAD_IN_PROGRESS' });
        return;
      }
      lockAcquired = true;

      // Use Redis-based chunk counter to track all chunks received
      const chunkCountKey = `upload:chunks:${roomId}:${participantId}:${sessionId}`;
      let currentCount;
      try {
        currentCount = await redis.incr(chunkCountKey);
        await redis.expire(chunkCountKey, ROOM_TTL_SEC);
      } catch (redisError) {
        console.error('Redis counter error:', redisError);
        await redis.del(lockKey).catch(err => console.error('Failed to release lock:', err));
        lockAcquired = false;
        res.status(500).json({ error: 'Failed to track chunk count', code: 'REDIS_COUNTER_ERROR' });
        return;
      }

      // Check if all chunks received
      if (currentCount === totalChunksNum) {
        const participantDir = path.join(RECORDINGS_DIR, roomId, sessionId, participantId);
        const outputPath = path.join(RECORDINGS_DIR, roomId, sessionId, `${participantId}.webm`);

        // Verify all chunk files exist before assembly
        const missingChunks: number[] = [];
        for (let i = 0; i < totalChunksNum; i++) {
          if (!fs.existsSync(path.join(participantDir, `chunk_${i}`))) {
            missingChunks.push(i);
          }
        }

        if (missingChunks.length > 0) {
          // Keep the counter so the client can retry the missing chunks
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
          // Assemble all chunks into a single file
          const chunks: Buffer[] = [];
          for (let i = 0; i < totalChunksNum; i++) {
            const chunkPath = path.join(participantDir, `chunk_${i}`);
            chunks.push(await fs.promises.readFile(chunkPath));
          }

          await fs.promises.writeFile(outputPath, Buffer.concat(chunks));

          // Delete chunks only after a successful write
          for (let i = 0; i < totalChunksNum; i++) {
            const chunkPath = path.join(participantDir, `chunk_${i}`);
            await fs.promises.unlink(chunkPath);
          }
          await fs.promises.rmdir(participantDir);

          // Delete the counter only after everything succeeds
          await redis.del(chunkCountKey);
        } catch (assemblyError) {
          console.error('Error assembling chunks:', assemblyError);
          // Keep the counter so the client can retry the final chunk
          await redis.decr(chunkCountKey);
          await redis.del(lockKey);
          lockAcquired = false;
          res.status(500).json({ error: 'Chunk assembly failed', code: 'CHUNK_ASSEMBLY_FAILED' });
          return;
        }

        // Update Redis uploadedTracks array atomically
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
            1,
            roomRecordingKey(roomId),
            participantId,
            ROOM_TTL_SEC.toString()
          );
          const updatedState = JSON.parse(updatedStateStr as string);

          // Upsert PostgreSQL recording_tracks
          const session = await db.select()
            .from(recordingSessions)
            .where(and(eq(recordingSessions.roomId, roomId), eq(recordingSessions.sessionId, sessionId)))
            .limit(1);

          if (session.length > 0) {
            await db.insert(recordingTracks).values({
              sessionId: session[0].id,
              participantId,
              status: 'uploaded',
            });

            // Check merge threshold: ≥50% of participants uploaded
            const participantCount = recordingState.participantCount || 0;
            const mergeThreshold = Math.ceil(participantCount * 0.5);

            if (updatedState.uploadedTracks.length >= mergeThreshold) {
              const tracks = [];
              for (const id of updatedState.uploadedTracks) {
                const offset = await redis.get(`recording:offset:${roomId}:${id}`);
                tracks.push({
                  participantId: id,
                  path: path.join(RECORDINGS_DIR, roomId, sessionId, `${id}.webm`),
                  startOffset: parseInt(offset || '0', 10),
                });
              }

              await mergeQueue.add('recording-merge', { roomId, sessionId, tracks });
            }
          }
        }
      }

      // Release lock only at end of successful path
      await redis.del(lockKey);
      lockAcquired = false;

      res.json({ success: true, chunkIndex: chunkIndexNum });
    } catch (error) {
      console.error('[Recording Chunk Error]', error);
      // --- FIX: always release lock in catch to avoid deadlock ---
      if (lockAcquired) {
        const lockKey = `upload:lock:${roomId}:${participantId}`;
        await redis.del(lockKey).catch(() => {});
      }
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

// GET /api/recordings/:sessionId/download
router.get(
  '/:sessionId/download',
  authenticateToken,
  async (req: Request<{ sessionId: string }>, res: Response): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const userId = (req as any).user!.id;

      // Fetch recording session from PostgreSQL
      const sessions = await db.select()
        .from(recordingSessions)
        .where(eq(recordingSessions.sessionId, sessionId))
        .limit(1);

      if (!sessions.length) {
        res.status(404).json({ error: 'Recording session not found', code: 'SESSION_NOT_FOUND' });
        return;
      }

      const session = sessions[0];

      // Verify the requester is the host
      if (session.startedBy !== userId) {
        res.status(403).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      if (!session.roomId) {
        res.status(404).json({ error: 'Invalid recording session', code: 'INVALID_SESSION' });
        return;
      }

      // --- FIX: check Postgres status first, then Redis as secondary source ---
      // Redis has a 24hr TTL and may have expired; Postgres is the source of truth
      const isDoneInPostgres = session.status === 'done';

      if (!isDoneInPostgres) {
        // Fall back to Redis for in-progress status
        const recordingState = await getRecordingState(session.roomId);
        res.status(404).json({
          error: 'NOT_READY',
          status: recordingState?.status || session.status || 'idle',
        });
        return;
      }

      // --- FIX: use outputPath from Postgres, not hardcoded path ---
      // The worker stores the real outputPath returned by mergeRecordings()
      const outputPath = session.outputPath;

      if (!outputPath) {
        res.status(500).json({ error: 'Output path missing from session record', code: 'NO_OUTPUT_PATH' });
        return;
      }

      if (!fs.existsSync(outputPath)) {
        res.status(500).json({ error: 'Recording file not found on disk', code: 'FILE_NOT_FOUND' });
        return;
      }

      const stat = fs.statSync(outputPath);
      const fileSize = stat.size;
      const fileName = `meeting-${sessionId}.mp4`;

      // --- FIX: Range request support for seekable video playback ---
      const rangeHeader = req.headers['range'];

      if (rangeHeader) {
        // Parse Range: bytes=START-END
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
        // Full file download
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
  }
);

// GET /api/recordings/:roomId/status
router.get(
  '/:id/status',
  authenticateToken,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const { id: roomId } = req.params;

      const participant = await db.select()
        .from(recordingSessions)
        .where(eq(recordingSessions.roomId, roomId))
        .limit(1);

      if (!participant.length) {
        res.status(404).json({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }

      // Combine Redis (live) + Postgres (fallback) since Redis state can expire
      const recordingState = await getRecordingState(roomId);
      const dbSession = participant[0];

      res.json({
        // Redis is preferred (live state); fall back to Postgres
        status: recordingState?.status || dbSession.status || 'idle',
        startedAt: recordingState?.startedAt || dbSession.createdAt,
        participantCount: recordingState?.participantCount,
        uploadedTracks: recordingState?.uploadedTracks || [],
        failedTracks: recordingState?.failedTracks || [],
        // Expose download link if ready, regardless of Redis state
        downloadUrl: dbSession.status === 'done'
          ? `/api/recordings/${dbSession.sessionId}/download`
          : null,
      });
    } catch (error) {
      console.error('[Get Recording Status Error]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

export default router;
