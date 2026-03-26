import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Router, Request, Response } from 'express';
import { redis } from '../config/redis';
import { authenticateToken } from '../middleware/auth';
import { db } from '../db';
import {
  deletionRequests,
  rooms,
  users,
} from '../db/schema';
import { exportQueue, deletionQueue } from '../jobs/account-jobs';
import { invalidateAllSessionsForUser } from '../services/session';
import { queueEmail } from '../services/email';

const router = Router();
const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT';
const EXPORT_RATE_LIMIT_SECONDS = 24 * 60 * 60;
const DELETION_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function verifyPassword(userId: string, password: string): Promise<{ valid: boolean; user?: {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  googleId: string | null;
  googleEmail: string | null;
  deletedAt: Date | null;
} }> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      emailVerified: users.emailVerified,
      avatarUrl: users.avatarUrl,
      googleId: users.googleId,
      googleEmail: users.googleEmail,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.passwordHash) {
    return { valid: false };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  return { valid, user };
}

router.post('/export/download', (_req, res) => {
  res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
});

router.post('/export', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      res.status(400).json({ error: 'PASSWORD_REQUIRED' });
      return;
    }

    const passwordResult = await verifyPassword(userId, password);
    if (!passwordResult.valid || !passwordResult.user) {
      res.status(401).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    const rateLimitResult = await redis.set(
      `export:ratelimit:${userId}`,
      '1',
      'EX',
      EXPORT_RATE_LIMIT_SECONDS,
      'NX',
    );
    if (rateLimitResult !== 'OK') {
      const retryAfter = Math.max(0, await redis.ttl(`export:ratelimit:${userId}`));
      res.status(429).json({ error: 'EXPORT_RATE_LIMITED', retryAfter });
      return;
    }

    await exportQueue.add(
      'export',
      { userId },
      {
        attempts: 2,
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    await queueEmail({
      to: passwordResult.user.email,
      template: 'data_export_started',
      data: {
        userName: passwordResult.user.name,
      },
    });

    res.status(200).json({ message: 'Export started. You\'ll get an email when it\'s ready.' });
  } catch (error) {
    console.error('[Account Export Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/export/status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const ttl = await redis.ttl(`export:ratelimit:${userId}`);
    res.status(200).json({
      canRequest: ttl <= 0,
      retryAfter: ttl > 0 ? ttl : 0,
    });
  } catch (error) {
    console.error('[Account Export Status Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/export/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'INVALID_TOKEN' });
      return;
    }

    const redisKey = `export:download:${token}`;
    const filePath = await redis.get(redisKey);
    if (!filePath) {
      res.status(404).json({ error: 'EXPORT_NOT_FOUND' });
      return;
    }

    await redis.del(redisKey);

    const fileName = path.basename(filePath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const stream = createReadStream(filePath);
    stream.on('error', async () => {
      res.status(404).end();
      try {
        await unlink(filePath);
      } catch {
        // ignore
      }
    });

    res.on('finish', async () => {
      try {
        await unlink(filePath);
      } catch {
        // ignore
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error('[Account Export Download Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/delete', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmation =
      typeof req.body?.confirmation === 'string' ? req.body.confirmation : '';

    if (confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
      res.status(400).json({ error: 'INVALID_CONFIRMATION' });
      return;
    }

    const passwordResult = await verifyPassword(userId, password);
    if (!passwordResult.valid || !passwordResult.user) {
      res.status(401).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    const [activeRoom] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.hostId, userId), eq(rooms.status, 'active')))
      .limit(1);

    if (activeRoom) {
      res.status(409).json({
        error: 'ACTIVE_ROOM',
        message: 'End your active meeting first',
      });
      return;
    }

    const now = new Date();
    const scheduledFor = new Date(now.getTime() + DELETION_GRACE_PERIOD_MS);

    const [requestRow] = await db
      .insert(deletionRequests)
      .values({
        userId,
        originalEmail: passwordResult.user.email,
        originalName: passwordResult.user.name,
        originalPasswordHash: passwordResult.user.passwordHash,
        originalEmailVerified: passwordResult.user.emailVerified,
        originalAvatarUrl: passwordResult.user.avatarUrl,
        originalGoogleId: passwordResult.user.googleId,
        originalGoogleEmail: passwordResult.user.googleEmail,
        scheduledFor,
      })
      .returning({ id: deletionRequests.id });

    const job = await deletionQueue.add(
      'delete',
      {
        userId,
        deletionRequestId: requestRow.id,
      },
      {
        delay: DELETION_GRACE_PERIOD_MS,
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    await db
      .update(deletionRequests)
      .set({ jobId: String(job.id) })
      .where(eq(deletionRequests.id, requestRow.id));

    await db
      .update(users)
      .set({
        deletedAt: now,
        email: `deleted-${userId}@deleted.local`,
        name: 'Deleted User',
        passwordHash: null,
        emailVerified: false,
        avatarUrl: null,
        googleId: null,
        googleEmail: null,
        googleLinkedAt: null,
      })
      .where(eq(users.id, userId));

    await invalidateAllSessionsForUser(userId);
    res.clearCookie('refreshToken');

    await queueEmail({
      to: passwordResult.user.email,
      template: 'account_deletion_scheduled',
      data: {
        userName: passwordResult.user.name,
        scheduledFor: scheduledFor.toISOString(),
      },
    });

    res.status(200).json({ message: 'Account scheduled for deletion' });
  } catch (error) {
    console.error('[Account Delete Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cancel-deletion', async (req: Request, res: Response): Promise<void> => {
  try {
    const originalEmail =
      typeof req.body?.originalEmail === 'string' ? normalizeEmail(req.body.originalEmail) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!originalEmail || !password) {
      res.status(400).json({ error: 'EMAIL_AND_PASSWORD_REQUIRED' });
      return;
    }

    const [requestRow] = await db
      .select({
        id: deletionRequests.id,
        userId: deletionRequests.userId,
        originalEmail: deletionRequests.originalEmail,
        originalName: deletionRequests.originalName,
        originalPasswordHash: deletionRequests.originalPasswordHash,
        originalEmailVerified: deletionRequests.originalEmailVerified,
        originalAvatarUrl: deletionRequests.originalAvatarUrl,
        originalGoogleId: deletionRequests.originalGoogleId,
        originalGoogleEmail: deletionRequests.originalGoogleEmail,
        scheduledFor: deletionRequests.scheduledFor,
        cancelledAt: deletionRequests.cancelledAt,
        processedAt: deletionRequests.processedAt,
        jobId: deletionRequests.jobId,
      })
      .from(deletionRequests)
      .where(eq(deletionRequests.originalEmail, originalEmail))
      .orderBy(desc(deletionRequests.requestedAt))
      .limit(1);

    if (
      !requestRow ||
      !requestRow.userId ||
      requestRow.cancelledAt ||
      requestRow.processedAt ||
      requestRow.scheduledFor.getTime() <= Date.now()
    ) {
      res.status(404).json({ error: 'DELETION_REQUEST_NOT_FOUND' });
      return;
    }

    if (!requestRow.originalPasswordHash) {
      res.status(400).json({ error: 'PASSWORD_UNAVAILABLE' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, requestRow.originalPasswordHash);
    if (!passwordValid) {
      res.status(401).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    if (requestRow.jobId) {
      const job = await deletionQueue.getJob(requestRow.jobId);
      if (job) {
        await job.remove();
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(deletionRequests)
        .set({ cancelledAt: new Date() })
        .where(eq(deletionRequests.id, requestRow.id));

      await tx
        .update(users)
        .set({
          deletedAt: null,
          email: requestRow.originalEmail,
          name: requestRow.originalName,
          passwordHash: requestRow.originalPasswordHash,
          emailVerified: requestRow.originalEmailVerified,
          avatarUrl: requestRow.originalAvatarUrl,
          googleId: requestRow.originalGoogleId,
          googleEmail: requestRow.originalGoogleEmail,
          googleLinkedAt: requestRow.originalGoogleId ? new Date() : null,
        })
        .where(eq(users.id, requestRow.userId!));
    });

    await queueEmail({
      to: requestRow.originalEmail,
      template: 'account_deletion_cancelled',
      data: {
        userName: requestRow.originalName,
      },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Cancel Account Deletion Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
