import express, { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth';
import { verifyRoomToken } from '../utils/jwt';
import { db } from '../db';
import { rooms } from '../db/schema';
import { mergeRecordings } from '../services/recording-merge';

const router = Router();
const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');

router.post(
  '/chunk',
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const roomId = String(req.query.roomId ?? '');
      const participantId = String(req.query.participantId ?? '');
      const chunkIndex = Number(req.query.chunkIndex);
      const totalChunks = Number(req.query.totalChunks);
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const payload = token ? verifyRoomToken(token) : null;

      if (!payload) {
        res.status(401).json({ error: 'Invalid room token', code: 'UNAUTHORIZED' });
        return;
      }
      if (payload.roomId !== roomId || payload.userId !== participantId) {
        res.status(403).json({ error: 'Room token mismatch', code: 'FORBIDDEN' });
        return;
      }
      if (!roomId || !participantId || Number.isNaN(chunkIndex) || Number.isNaN(totalChunks) || totalChunks <= 0) {
        res.status(400).json({ error: 'Invalid chunk metadata', code: 'BAD_REQUEST' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Chunk body required', code: 'BAD_REQUEST' });
        return;
      }

      const roomDir = path.join(RECORDINGS_DIR, roomId);
      const chunksDir = path.join(roomDir, 'chunks');
      await fs.mkdir(chunksDir, { recursive: true });
      const chunkPath = path.join(chunksDir, `${participantId}.${chunkIndex}.part`);
      await fs.writeFile(chunkPath, req.body as Buffer);

      const chunkFiles = await fs.readdir(chunksDir);
      const ownChunks = chunkFiles.filter((file) => file.startsWith(`${participantId}.`) && file.endsWith('.part'));
      const assembled = ownChunks.length >= totalChunks;

      if (assembled) {
        const outputPath = path.join(roomDir, `${participantId}.webm`);
        const orderedChunkPaths = Array.from({ length: totalChunks }, (_, index) =>
          path.join(chunksDir, `${participantId}.${index}.part`)
        );
        const chunkBuffers = await Promise.all(orderedChunkPaths.map((chunkFile) => fs.readFile(chunkFile)));
        await fs.writeFile(outputPath, Buffer.concat(chunkBuffers));
        await Promise.all(orderedChunkPaths.map((chunkFile) => fs.unlink(chunkFile).catch(() => {})));
      }

      res.json({ ok: true, assembled });
    } catch (error) {
      console.error('[Recordings chunk upload]', error);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
);

router.post(
  '/:roomId/merge',
  authenticateToken,
  async (req: Request<{ roomId: string }>, res: Response): Promise<void> => {
    try {
      const { roomId } = req.params;
      const userId = req.user!.id;
      const [room] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.hostId, userId)))
        .limit(1);

      if (!room) {
        res.status(403).json({ error: 'Only the host can merge recordings', code: 'FORBIDDEN' });
        return;
      }

      const result = await mergeRecordings(roomId);
      res.json({ ok: true, outputPath: result.outputPath, skipped: result.skipped });
    } catch (error) {
      console.error('[Recordings merge]', error);
      res.status(500).json({ error: 'Failed to merge recordings', code: 'MERGE_FAILED' });
    }
  }
);

router.get(
  '/:roomId/download',
  authenticateToken,
  async (req: Request<{ roomId: string }>, res: Response): Promise<void> => {
    try {
      const { roomId } = req.params;
      const userId = req.user!.id;
      const [room] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.hostId, userId)))
        .limit(1);

      if (!room) {
        res.status(403).json({ error: 'Only the host can download recordings', code: 'FORBIDDEN' });
        return;
      }

      const filePath = path.join(RECORDINGS_DIR, roomId, 'final.mp4');
      await fs.access(filePath);
      res.download(filePath, `${roomId}-final.mp4`);
    } catch (error) {
      console.error('[Recordings download]', error);
      res.status(404).json({ error: 'Recording not found', code: 'NOT_FOUND' });
    }
  }
);

export default router;
