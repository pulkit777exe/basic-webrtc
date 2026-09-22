import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Router, Request, Response } from 'express';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { createAndSendOtp, verifyOtp } from '../../services/otp.js';
import { redis } from '../../config/redis.js';
import { authenticateToken, requireUser } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { backupCodes, users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt.js';
import { getClientIp } from '../../services/session.js';
import { strictLimiter } from '../../lib/rate-limiters.js';
import { BACKUP_CODE_RECOVERY_MAX_ATTEMPTS, BACKUP_CODE_RECOVERY_WINDOW_SECONDS, RECOVERY_EMAIL_RECOVERY_MAX_ATTEMPTS, RECOVERY_EMAIL_RECOVERY_WINDOW_SECONDS, RECOVERY_EMAIL_VERIFY_MAX_ATTEMPTS, RECOVERY_EMAIL_VERIFY_WINDOW_SECONDS, RECOVERY_GENERIC_SUCCESS_MESSAGE, RECOVERY_EMAIL_RESEND_MAX, RECOVERY_EMAIL_RESEND_WINDOW_SECONDS, normalizeEmail, normalizeBackupCode, isValidEmailFormat, applyRateLimit, createAndQueuePasswordResetEmail, attachAuthSession } from './shared.js';
import { logger } from '../../lib/logger';

const router = Router();

router.post(
  '/recover/backup-code',
  strictLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const emailInput = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      const backupCodeInput =
        typeof req.body?.backupCode === 'string' ? normalizeBackupCode(req.body.backupCode) : '';
      const ipAddress = getClientIp(req) ?? 'unknown';
      const userAgent = req.headers['user-agent'] ?? 'Unknown';

      const rateLimit = await applyRateLimit(
        `ratelimit:recover:backup:${ipAddress}`,
        BACKUP_CODE_RECOVERY_MAX_ATTEMPTS,
        BACKUP_CODE_RECOVERY_WINDOW_SECONDS,
      );
      if (rateLimit.limited) {
        res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }

      if (!emailInput || backupCodeInput.length !== 10) {
        res.status(400).json({ error: 'INVALID' });
        return;
      }

      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
          emailVerified: users.emailVerified,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailInput}`)
        .limit(1);

      if (!user || !user.emailVerified) {
        res.status(400).json({ error: 'INVALID' });
        return;
      }

      const incomingHash = createHash('sha256').update(backupCodeInput).digest('hex');
      const [matchedCode] = await db
        .select({
          id: backupCodes.id,
        })
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
        res.status(400).json({ error: 'INVALID' });
        return;
      }

      await db
        .update(backupCodes)
        .set({ usedAt: new Date() })
        .where(eq(backupCodes.id, matchedCode.id));

      const [remaining] = await db
        .select({ count: sql<number>`count(*)` })
        .from(backupCodes)
        .where(and(eq(backupCodes.userId, user.id), isNull(backupCodes.usedAt)));
      const codesRemaining = Number(remaining?.count ?? 0);

      const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email,
      });
      const refreshToken = generateRefreshToken({
        userId: user.id,
        email: user.email,
      });
      await attachAuthSession(req, res, user.id, accessToken, refreshToken);

      try {
        await queueEmail({
          to: user.email,
          template: 'backup_code_security_alert',
          data: {
            userName: user.name,
            timestamp: new Date().toISOString(),
            ipAddress: ipAddress || undefined,
            userAgent: String(userAgent),
          },
        });
      } catch (emailError) {
        logger.error('[Backup Code Alert Email Error]', { err: emailError });
      }

      res.status(200).json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          emailVerified: user.emailVerified,
        },
        accessToken,
        codesRemaining,
        ...(codesRemaining < 3 ? { warning: 'LOW_BACKUP_CODES' } : {}),
      });
    } catch (error) {
      logger.error('[Backup Code Recovery Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/recovery-email/add',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const recoveryEmail =
        typeof req.body?.recoveryEmail === 'string' ? normalizeEmail(req.body.recoveryEmail) : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!recoveryEmail || !isValidEmailFormat(recoveryEmail)) {
        res.status(400).json({ error: 'INVALID_RECOVERY_EMAIL' });
        return;
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }

      if (recoveryEmail === normalizeEmail(user.email)) {
        res.status(400).json({ error: 'RECOVERY_EMAIL_MATCHES_PRIMARY' });
        return;
      }

      if (user.passwordHash) {
        if (!password) {
          res.status(400).json({ error: 'PASSWORD_REQUIRED' });
          return;
        }
        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
          res.status(401).json({ error: 'INVALID_PASSWORD' });
          return;
        }
      }

      const [conflict] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            ne(users.id, userId),
            or(
              sql`lower(${users.email}) = ${recoveryEmail}`,
              sql`lower(${users.recoveryEmail}) = ${recoveryEmail}`,
            ),
          ),
        )
        .limit(1);

      if (conflict) {
        res.status(409).json({ error: 'RECOVERY_EMAIL_IN_USE' });
        return;
      }

      await db
        .update(users)
        .set({
          recoveryEmail,
          recoveryEmailVerified: false,
        })
        .where(eq(users.id, userId));
      await createAndSendOtp(recoveryEmail);

      res.status(200).json({ message: 'Verification sent to recovery email' });
    } catch (error) {
      logger.error('[Add Recovery Email Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/recovery-email/resend',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const [user] = await db
        .select({
          recoveryEmail: users.recoveryEmail,
          recoveryEmailVerified: users.recoveryEmailVerified,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user?.recoveryEmail || user.recoveryEmailVerified) {
        res.status(200).json({ message: 'Verification sent to recovery email' });
        return;
      }

      const rateLimit = await applyRateLimit(
        `ratelimit:recovery-email-resend:${user.recoveryEmail}`,
        RECOVERY_EMAIL_RESEND_MAX,
        RECOVERY_EMAIL_RESEND_WINDOW_SECONDS,
      );
      if (rateLimit.limited) {
        res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }

      await createAndSendOtp(user.recoveryEmail);
      res.status(200).json({ message: 'Verification sent to recovery email' });
    } catch (error) {
      logger.error('[Resend Recovery Email Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/recovery-email/verify',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
        return;
      }

      const [user] = await db
        .select({
          recoveryEmail: users.recoveryEmail,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user?.recoveryEmail) {
        res.status(400).json({ error: 'RECOVERY_EMAIL_NOT_SET' });
        return;
      }

      const verifyAttemptsKey = `ratelimit:recovery-email-verify:${userId}`;
      const verifyRateLimit = await applyRateLimit(
        verifyAttemptsKey,
        RECOVERY_EMAIL_VERIFY_MAX_ATTEMPTS,
        RECOVERY_EMAIL_VERIFY_WINDOW_SECONDS,
      );
      if (verifyRateLimit.limited) {
        res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfter: verifyRateLimit.retryAfter,
        });
        return;
      }

      const isValidOtp = await verifyOtp(user.recoveryEmail, otp);
      if (!isValidOtp) {
        res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
        return;
      }

      await db.update(users).set({ recoveryEmailVerified: true }).where(eq(users.id, userId));
      await redis.del(verifyAttemptsKey);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[Verify Recovery Email Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.delete(
  '/recovery-email',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      await db
        .update(users)
        .set({
          recoveryEmail: null,
          recoveryEmailVerified: false,
        })
        .where(eq(users.id, userId));

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[Remove Recovery Email Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post('/recover/recovery-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const primaryEmail =
      typeof req.body?.primaryEmail === 'string' ? normalizeEmail(req.body.primaryEmail) : '';
    const ipAddress = getClientIp(req) ?? 'unknown';

    const rateLimit = await applyRateLimit(
      `ratelimit:recover:recovery-email:${ipAddress}`,
      RECOVERY_EMAIL_RECOVERY_MAX_ATTEMPTS,
      RECOVERY_EMAIL_RECOVERY_WINDOW_SECONDS,
    );
    if (rateLimit.limited) {
      res.status(429).json({
        error: 'TOO_MANY_ATTEMPTS',
        retryAfter: rateLimit.retryAfter,
      });
      return;
    }

    if (!primaryEmail) {
      res.status(200).json({ message: RECOVERY_GENERIC_SUCCESS_MESSAGE });
      return;
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        recoveryEmail: users.recoveryEmail,
        recoveryEmailVerified: users.recoveryEmailVerified,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${primaryEmail}`)
      .limit(1);

    if (user?.recoveryEmail && user.recoveryEmailVerified) {
      try {
        await createAndQueuePasswordResetEmail({
          userId: user.id,
          userName: user.name,
          deliveryEmail: user.recoveryEmail,
          req,
        });
      } catch (emailError) {
        logger.error('[Recovery Email Reset Dispatch Error]', { err: emailError });
      }
    }

    res.status(200).json({ message: RECOVERY_GENERIC_SUCCESS_MESSAGE });
  } catch (error) {
    logger.error('[Recover With Recovery Email Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
