import bcrypt from 'bcrypt';
import { cookieOptions } from '../../utils/cookies.js';
import { Router, Request, Response } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { deleteRefreshSession } from '../../config/redis.js';
import { authenticateToken, requireUser } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { backupCodes, users } from '../../db/schema.js';
import { listActiveSessionsForUser, revokeAllSessionsForUser, revokeSessionById } from '../../services/session.js';
import { parseBoolean, generateBackupCodesForUser } from './shared.js';

const router = Router();

router.get('/sessions', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = requireUser(req, res);
    if (!authUser) return;
    const userId = authUser.id;
    const currentTokenHash = req.authTokenHash ?? null;
    const sessions = await listActiveSessionsForUser(userId, currentTokenHash);

    res.status(200).json({
      sessions: sessions.map((session) => ({
        id: session.id,
        deviceName: session.deviceName,
        deviceType: session.deviceType,
        browser: session.browser,
        os: session.os,
        ipAddress: session.ipAddress,
        location: session.location,
        lastActiveAt: session.lastActiveAt,
        createdAt: session.createdAt,
        isCurrent: session.isCurrent,
      })),
    });
  } catch (error) {
    console.error('[Sessions List Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/sessions/:sessionId/revoke',
  authenticateToken,
  async (req: Request<{ sessionId: string }>, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const { sessionId } = req.params;
      const result = await revokeSessionById(userId, sessionId);
      if (!result.success || !result.tokenHash) {
        res.status(404).json({ error: 'SESSION_NOT_FOUND' });
        return;
      }

      const isCurrent = req.authTokenHash === result.tokenHash;
      if (isCurrent) {
        res.clearCookie('refreshToken', cookieOptions);
      }

      res.status(200).json({ success: true, currentSessionRevoked: isCurrent });
    } catch (error) {
      console.error('[Session Revoke Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/sessions/revoke-all',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const exceptCurrent = parseBoolean(req.body?.exceptCurrent);
      const currentTokenHash = req.authTokenHash ?? null;
      const revokedCount = await revokeAllSessionsForUser(
        userId,
        exceptCurrent ? currentTokenHash : null,
      );

      if (!exceptCurrent) {
        await deleteRefreshSession(userId);
        res.clearCookie('refreshToken', cookieOptions);
      }

      res.status(200).json({ revokedCount });
    } catch (error) {
      console.error('[Sessions Revoke All Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get(
  '/backup-codes/status',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const [user] = await db
        .select({
          backupCodesGeneratedAt: users.backupCodesGeneratedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const [remaining] = await db
        .select({ count: sql<number>`count(*)` })
        .from(backupCodes)
        .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));

      res.status(200).json({
        remaining: Number(remaining?.count ?? 0),
        backupCodesGeneratedAt: user?.backupCodesGeneratedAt ?? null,
      });
    } catch (error) {
      console.error('[Backup Codes Status Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/backup-codes/generate',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const [user] = await db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }

      if (user.passwordHash) {
        if (!password) {
          res.status(400).json({ error: 'PASSWORD_REQUIRED' });
          return;
        }
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
          res.status(401).json({ error: 'INVALID_PASSWORD' });
          return;
        }
      }

      const result = await generateBackupCodesForUser(userId);

      res.status(200).json({
        codes: result.formattedCodes,
        generatedAt: result.generatedAt.toISOString(),
      });
    } catch (error) {
      console.error('[Generate Backup Codes Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);


export default router;
