import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { hashToken } from '../../utils/crypto.js';
import { Router, Request, Response } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { redis } from '../../config/redis.js';
import { authenticateToken, requireUser } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { backupCodes, users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { verifyTwoFactorPendingToken } from '../../utils/jwt.js';
import { getClientIp, revokeAllSessionsForUser } from '../../services/session.js';
import { strictLimiter } from '../../lib/rate-limiters.js';
import { decrypt, encrypt } from '../../lib/encryption.js';
import { buildOtpUri, buildQrCodeDataUrl, formatManualEntryKey, generateTwoFactorSecret, getTwoFactorSetupTtlSeconds, twoFactorPendingLoginKey, twoFactorPendingSetupKey, twoFactorUsedCodeKey, verifyTotpToken } from '../../services/two-factor.js';
import { TWO_FACTOR_VALIDATE_RATE_LIMIT_WINDOW_SECONDS, TWO_FACTOR_VALIDATE_RATE_LIMIT_MAX, APP_NAME, normalizeBackupCode, applyRateLimit, twoFactorValidateRateLimitKey, generateBackupCodesForUser, completeSuccessfulLogin, mapUserForAuthResponse } from './shared.js';
import { logger } from '../../lib/logger';

const router = Router();

router.post('/2fa/setup', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = requireUser(req, res);
    if (!authUser) return;
    const userId = authUser.id;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
        twoFactorEnabled: users.twoFactorEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }
    if (!user.emailVerified) {
      res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
      return;
    }
    if (user.twoFactorEnabled) {
      res.status(400).json({ error: '2FA_ALREADY_ENABLED' });
      return;
    }
    if (!user.passwordHash) {
      res.status(400).json({ error: 'PASSWORD_REQUIRED' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      res.status(401).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    const secret = generateTwoFactorSecret();
    await redis.set(twoFactorPendingSetupKey(userId), secret, {
      ex: getTwoFactorSetupTtlSeconds(),
    });

    const otpUri = buildOtpUri(user.email, APP_NAME, secret);
    const qrCode = await buildQrCodeDataUrl(otpUri);
    res.status(200).json({
      qrCode,
      manualEntryKey: formatManualEntryKey(secret),
    });
  } catch (error) {
    logger.error('[2FA Setup Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/2fa/verify-setup',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const totp = typeof req.body?.totp === 'string' ? req.body.totp.trim() : '';
      if (!/^\d{6}$/.test(totp)) {
        res.status(400).json({ error: 'INVALID_CODE' });
        return;
      }

      const setupKey = twoFactorPendingSetupKey(userId);
      const secret = await redis.get(setupKey);
      if (!secret) {
        res.status(400).json({ error: 'SETUP_EXPIRED' });
        return;
      }

      const isValid = verifyTotpToken(String(secret), totp);
      if (!isValid) {
        res.status(400).json({ error: 'INVALID_CODE' });
        return;
      }

      const encryptedSecret = encrypt(String(secret));
      const now = new Date();
      await db
        .update(users)
        .set({
          twoFactorEnabled: true,
          twoFactorSecret: encryptedSecret,
          twoFactorEnabledAt: now,
        })
        .where(eq(users.id, userId));
      await redis.del(setupKey);

      const backupCodesResult = await generateBackupCodesForUser(userId);
      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (user) {
        try {
          await queueEmail({
            to: user.email,
            template: 'two_factor_enabled',
            data: {
              userName: user.name,
              timestamp: now.toISOString(),
            },
          });
        } catch (emailError) {
          logger.error('[2FA Enabled Email Error]', { err: emailError });
        }
      }

      res.status(200).json({
        success: true,
        backupCodes: backupCodesResult.formattedCodes,
      });
    } catch (error) {
      logger.error('[2FA Verify Setup Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/2fa/disable',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const totp = typeof req.body?.totp === 'string' ? req.body.totp.trim() : '';
      if (!password || !/^\d{6}$/.test(totp)) {
        res.status(400).json({ error: 'PASSWORD_AND_TOTP_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
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
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        res.status(400).json({ error: '2FA_NOT_ENABLED' });
        return;
      }
      if (!user.passwordHash) {
        res.status(400).json({ error: 'PASSWORD_REQUIRED' });
        return;
      }

      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      const secret = decrypt(user.twoFactorSecret);
      const totpValid = verifyTotpToken(secret, totp);
      if (!totpValid) {
        res.status(400).json({ error: 'INVALID_CODE' });
        return;
      }

      await db
        .update(users)
        .set({
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorEnabledAt: null,
        })
        .where(eq(users.id, userId));
      await revokeAllSessionsForUser(userId, req.authTokenHash ?? null);

      try {
        await queueEmail({
          to: user.email,
          template: 'two_factor_disabled',
          data: {
            userName: user.name,
            timestamp: new Date().toISOString(),
            ipAddress: getClientIp(req) ?? undefined,
          },
        });
      } catch (emailError) {
        logger.error('[2FA Disabled Email Error]', { err: emailError });
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[2FA Disable Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post('/2fa/validate', strictLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const pendingToken =
      typeof req.body?.pendingToken === 'string' ? req.body.pendingToken.trim() : '';
    const totp = typeof req.body?.totp === 'string' ? req.body.totp.trim() : '';
    const backupCodeRaw =
      typeof req.body?.backupCode === 'string' ? req.body.backupCode.trim() : '';

    if (!pendingToken) {
      res.status(401).json({ error: 'PENDING_TOKEN_REQUIRED' });
      return;
    }
    const pendingPayload = verifyTwoFactorPendingToken(pendingToken);
    if (!pendingPayload) {
      res.status(401).json({ error: 'PENDING_TOKEN_EXPIRED' });
      return;
    }

    const pendingHash = hashToken(pendingToken);
    const pendingKey = twoFactorPendingLoginKey(pendingHash);
    const pendingUserId = await redis.get(pendingKey);
    if (!pendingUserId || pendingUserId !== pendingPayload.userId) {
      res.status(401).json({ error: 'PENDING_TOKEN_EXPIRED' });
      return;
    }

    const validateRateLimit = await applyRateLimit(
      twoFactorValidateRateLimitKey(pendingPayload.userId),
      TWO_FACTOR_VALIDATE_RATE_LIMIT_MAX,
      TWO_FACTOR_VALIDATE_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (validateRateLimit.limited) {
      res.status(429).json({
        error: 'TOO_MANY_ATTEMPTS',
        retryAfter: validateRateLimit.retryAfter,
      });
      return;
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorSecret: users.twoFactorSecret,
      })
      .from(users)
      .where(eq(users.id, pendingPayload.userId))
      .limit(1);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      res.status(400).json({ error: '2FA_NOT_ENABLED' });
      return;
    }

    let backupCodesRemaining: number | null = null;
    if (totp) {
      if (!/^\d{6}$/.test(totp)) {
        res.status(400).json({ error: 'INVALID_CODE' });
        return;
      }
      const secret = decrypt(user.twoFactorSecret);
      const validTotp = verifyTotpToken(secret, totp);
      if (!validTotp) {
        res.status(400).json({ error: 'INVALID_CODE' });
        return;
      }

      const replayKey = twoFactorUsedCodeKey(user.id, totp);
      const replaySet = await redis.set(replayKey, '1', { ex: 60, nx: true });
      if (!replaySet) {
        res.status(400).json({ error: 'CODE_ALREADY_USED' });
        return;
      }
    } else if (backupCodeRaw) {
      const normalizedCode = normalizeBackupCode(backupCodeRaw);
      const incomingHash = createHash('sha256').update(normalizedCode).digest('hex');
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
        res.status(400).json({ error: 'INVALID_BACKUP_CODE' });
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
      backupCodesRemaining = Number(remaining?.count ?? 0);
    } else {
      res.status(400).json({ error: 'CODE_REQUIRED' });
      return;
    }

    await redis.del(pendingKey);
    await redis.del(twoFactorValidateRateLimitKey(user.id));

    const loginResult = await completeSuccessfulLogin({
      req,
      res,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
      },
    });

    if (loginResult.requiresSuspiciousLoginVerification) {
      res.status(200).json({
        requiresSuspiciousLoginVerification: true,
        reasons: loginResult.reasons,
        accessToken: loginResult.accessToken,
        ...(backupCodesRemaining !== null ? { backupCodesRemaining } : {}),
      });
      return;
    }

    res.status(200).json({
      user: mapUserForAuthResponse(user),
      accessToken: loginResult.accessToken,
      ...(backupCodesRemaining !== null ? { backupCodesRemaining } : {}),
    });
  } catch (error) {
    logger.error('[2FA Validate Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
