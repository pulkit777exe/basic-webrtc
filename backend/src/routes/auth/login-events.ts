import { createHash } from 'crypto';
import { hashToken } from '../../utils/crypto.js';
import { cookieOptions } from '../../utils/cookies.js';
import { Router, Request, Response } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createAndSendOtp, verifyOtp } from '../../services/otp.js';
import { setRefreshSession } from '../../config/redis.js';
import { authenticateToken } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { backupCodes, loginEvents, users } from '../../db/schema.js';
import { generateRefreshToken } from '../../utils/jwt.js';
import { markSessionSuspiciousVerified } from '../../services/session.js';
import { decrypt } from '../../lib/encryption.js';
import { verifyTotpToken } from '../../services/two-factor.js';
import { normalizeBackupCode, maskIpAddress } from './shared.js';

const router = Router();

router.post(
  '/verify-suspicious-login',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.authTokenHash || !req.user) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
      }

      if (!req.restrictedSession) {
        res.status(200).json({ success: true });
        return;
      }

      const method = typeof req.body?.method === 'string' ? req.body.method : '';
      const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
      const userId = req.user.id;
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          twoFactorEnabled: users.twoFactorEnabled,
          twoFactorSecret: users.twoFactorSecret,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }

      if (method === 'email_otp') {
        if (!code) {
          await createAndSendOtp(user.email);
          res.status(200).json({ status: 'OTP_SENT' });
          return;
        }
        const verified = await verifyOtp(user.email, code);
        if (!verified) {
          res.status(400).json({ error: 'INVALID_CODE' });
          return;
        }
      } else if (method === 'totp') {
        if (!user.twoFactorEnabled || !user.twoFactorSecret) {
          res.status(400).json({ error: '2FA_NOT_ENABLED' });
          return;
        }
        const secret = decrypt(user.twoFactorSecret);
        const valid = verifyTotpToken(secret, code);
        if (!valid) {
          res.status(400).json({ error: 'INVALID_CODE' });
          return;
        }
      } else if (method === 'backup_code') {
        const normalizedCode = normalizeBackupCode(code);
        const incomingHash = createHash('sha256').update(normalizedCode).digest('hex');
        const [matchedCode] = await db
          .select({ id: backupCodes.id })
          .from(backupCodes)
          .where(
            and(
              eq(backupCodes.userId, user.id),
              eq(backupCodes.codeHash, incomingHash),
              isNull(backupCodes.usedAt),
            ),
          )
          .limit(1);
        if (!matchedCode) {
          res.status(400).json({ error: 'INVALID_CODE' });
          return;
        }
        await db
          .update(backupCodes)
          .set({ usedAt: new Date() })
          .where(eq(backupCodes.id, matchedCode.id));
      } else {
        res.status(400).json({ error: 'INVALID_METHOD' });
        return;
      }

      await markSessionSuspiciousVerified(req.authTokenHash);
      const refreshToken = generateRefreshToken({
        userId: user.id,
        email: user.email,
      });
      await setRefreshSession(user.id, hashToken(refreshToken));
      res.cookie('refreshToken', refreshToken, cookieOptions);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Verify Suspicious Login Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get(
  '/login-events',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const offsetRaw = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
      const limit = 20;

      const events = await db
        .select({
          id: loginEvents.id,
          sessionId: loginEvents.sessionId,
          ipAddress: loginEvents.ipAddress,
          country: loginEvents.country,
          city: loginEvents.city,
          browser: loginEvents.browser,
          os: loginEvents.os,
          deviceType: loginEvents.deviceType,
          isSuspicious: loginEvents.isSuspicious,
          suspiciousReasons: loginEvents.suspiciousReasons,
          confirmedAt: loginEvents.confirmedAt,
          createdAt: loginEvents.createdAt,
        })
        .from(loginEvents)
        .where(eq(loginEvents.userId, userId))
        .orderBy(desc(loginEvents.createdAt))
        .limit(limit + 1)
        .offset(offset);

      const hasMore = events.length > limit;
      const payload = hasMore ? events.slice(0, limit) : events;
      res.status(200).json({
        events: payload.map((event) => ({
          ...event,
          ipAddress: maskIpAddress(event.ipAddress),
          suspiciousReasons: Array.isArray(event.suspiciousReasons) ? event.suspiciousReasons : [],
        })),
        nextOffset: hasMore ? offset + limit : null,
      });
    } catch (error) {
      console.error('[Login Events Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/login-events/:eventId/confirm',
  authenticateToken,
  async (req: Request<{ eventId: string }>, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { eventId } = req.params;
      const [event] = await db
        .select({ id: loginEvents.id })
        .from(loginEvents)
        .where(and(eq(loginEvents.id, eventId), eq(loginEvents.userId, userId)))
        .limit(1);
      if (!event) {
        res.status(404).json({ error: 'EVENT_NOT_FOUND' });
        return;
      }
      await db
        .update(loginEvents)
        .set({ confirmedAt: new Date(), isSuspicious: false })
        .where(eq(loginEvents.id, event.id));
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Confirm Login Event Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
