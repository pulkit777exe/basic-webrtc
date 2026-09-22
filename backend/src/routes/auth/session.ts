import bcrypt from 'bcrypt';
import { hashToken, getFrontendBaseUrl } from '../../utils/crypto.js';
import { cookieOptions } from '../../utils/cookies.js';
import { Router, Request, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { refreshTokens } from '../../services/auth.js';
import { redis, deleteRefreshSession } from '../../config/redis.js';
import { logoutRevoke } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { mightExist } from '../../utils/bloomFilter.js';
import { generateTwoFactorPendingToken, verifyRefreshToken } from '../../utils/jwt.js';
import { createSessionForAccessToken, extractAccessToken, getClientIp, hashSessionToken, revokeSessionByTokenHash } from '../../services/session.js';
import { loginLimiter } from '../../lib/rate-limiters.js';
import { twoFactorPendingLoginKey } from '../../services/two-factor.js';
import { TWO_FACTOR_PENDING_LOGIN_WINDOW_SECONDS, LOGIN_FAILURE_CAPTCHA_THRESHOLD, DUMMY_BCRYPT_HASH, normalizeEmail, lockoutSecondsForAttempts, incrementLoginFailureIpCounter, clearLoginFailureIpCounter, shouldRequireCaptcha, verifyCaptchaToken, markAccountLockInRedis, clearAccountLockState, getActiveLockFromRedis, completeSuccessfulLogin, mapUserForAuthResponse } from './shared.js';
import { logger } from '../../lib/logger';

const router = Router();

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const emailInput = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const captchaToken = typeof req.body?.captchaToken === 'string' ? req.body.captchaToken : '';
    const ipAddress = getClientIp(req) ?? 'unknown';

    const captchaRequired = await shouldRequireCaptcha(ipAddress);
    if (captchaRequired) {
      const captchaValid = await verifyCaptchaToken(captchaToken);
      if (!captchaValid) {
        res.status(400).json({ error: 'CAPTCHA_REQUIRED' });
        return;
      }
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
        failedLoginAttempts: users.failedLoginAttempts,
        lockedUntil: users.lockedUntil,
        twoFactorEnabled: users.twoFactorEnabled,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${emailInput}`)
      .limit(1);

    if (!user || !user.passwordHash) {
      await bcrypt.compare(password || 'invalid', DUMMY_BCRYPT_HASH);
      const ipFailures = await incrementLoginFailureIpCounter(ipAddress);
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        ...(ipFailures > LOGIN_FAILURE_CAPTCHA_THRESHOLD ? { captchaRequired: true } : {}),
      });
      return;
    }

    if (user.deletedAt) {
      res.status(403).json({ error: 'ACCOUNT_SCHEDULED_FOR_DELETION' });
      return;
    }

    const lockFromRedis = await getActiveLockFromRedis(user.id);
    if (lockFromRedis) {
      const remainingSeconds = Math.max(
        1,
        Math.ceil((lockFromRedis.getTime() - Date.now()) / 1000),
      );
      res.status(423).json({
        error: 'ACCOUNT_LOCKED',
        lockedUntil: lockFromRedis.toISOString(),
        remainingSeconds,
      });
      return;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await markAccountLockInRedis(user.id, user.lockedUntil);
      const remainingSeconds = Math.max(
        1,
        Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      );
      res.status(423).json({
        error: 'ACCOUNT_LOCKED',
        lockedUntil: user.lockedUntil.toISOString(),
        remainingSeconds,
      });
      return;
    }

    if (!mightExist(emailInput.split('@')[0])) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      const now = new Date();
      const failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      const lockoutSeconds = lockoutSecondsForAttempts(failedLoginAttempts);
      const ipFailures = await incrementLoginFailureIpCounter(ipAddress);

      if (lockoutSeconds > 0) {
        const lockedUntil = new Date(now.getTime() + lockoutSeconds * 1000);
        await db
          .update(users)
          .set({
            failedLoginAttempts,
            lastFailedLoginAt: now,
            lockedUntil,
          })
          .where(eq(users.id, user.id));
        await markAccountLockInRedis(user.id, lockedUntil);

        try {
          await queueEmail({
            to: user.email,
            template: 'account_lockout_alert',
            data: {
              userName: user.name,
              lockedUntil: lockedUntil.toISOString(),
              ipAddress,
              resetUrl: `${getFrontendBaseUrl()}/auth/forgot-password`,
            },
          });
        } catch (emailError) {
          logger.error('[Account Lockout Email Error]', { err: emailError });
        }

        res.status(423).json({
          error: 'ACCOUNT_LOCKED',
          lockedUntil: lockedUntil.toISOString(),
          remainingSeconds: lockoutSeconds,
          ...(ipFailures > LOGIN_FAILURE_CAPTCHA_THRESHOLD ? { captchaRequired: true } : {}),
        });
        return;
      }

      await db
        .update(users)
        .set({
          failedLoginAttempts,
          lastFailedLoginAt: now,
        })
        .where(eq(users.id, user.id));

      const attemptsLeft = Math.max(0, 5 - failedLoginAttempts);
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        ...(failedLoginAttempts >= 3 ? { attemptsLeft } : {}),
        ...(ipFailures > LOGIN_FAILURE_CAPTCHA_THRESHOLD ? { captchaRequired: true } : {}),
      });
      return;
    }

    const wasPreviouslyLocked = Boolean(
      user.lockedUntil && user.lockedUntil.getTime() <= Date.now(),
    );
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      })
      .where(eq(users.id, user.id));
    await clearAccountLockState(user.id);
    await clearLoginFailureIpCounter(ipAddress);

    if (!user.emailVerified) {
      res.status(403).json({
        error: 'Email not verified',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: false,
          avatarUrl: user.avatarUrl,
        },
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    if (user.twoFactorEnabled) {
      const pendingToken = generateTwoFactorPendingToken({
        userId: user.id,
        email: user.email,
      });
      await redis.set(twoFactorPendingLoginKey(hashToken(pendingToken)), user.id, {
        ex: TWO_FACTOR_PENDING_LOGIN_WINDOW_SECONDS,
      });
      res.status(200).json({
        requires2FA: true,
        pendingToken,
      });
      return;
    }

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

    if (wasPreviouslyLocked) {
      try {
        await queueEmail({
          to: user.email,
          template: 'account_lockout_cleared',
          data: {
            userName: user.name,
            ipAddress,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (emailError) {
        logger.error('[Account Recovered Email Error]', { err: emailError });
      }
    }

    if (loginResult.requiresSuspiciousLoginVerification) {
      res.status(200).json({
        requiresSuspiciousLoginVerification: true,
        reasons: loginResult.reasons,
        accessToken: loginResult.accessToken,
      });
      return;
    }

    res.status(200).json({
      user: mapUserForAuthResponse(user),
      accessToken: loginResult.accessToken,
    });
  } catch (error) {
    logger.error('[Login Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token required', code: 'UNAUTHORIZED' });
      return;
    }
    const result = await refreshTokens(refreshToken);
    if (!result) {
      res.status(403).json({ error: 'Invalid or expired refresh token', code: 'FORBIDDEN' });
      return;
    }
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, cookieOptions);
    }
    if (result.accessToken) {
      await createSessionForAccessToken(result.user.id, result.accessToken, req);
    }
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) {
    logger.error('[Refresh Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const accessToken = extractAccessToken(req);
    if (accessToken) {
      await revokeSessionByTokenHash(hashSessionToken(accessToken));
      await logoutRevoke(accessToken);
    }

    const refreshToken = req.cookies?.refreshToken;
    if (typeof refreshToken === 'string') {
      const payload = verifyRefreshToken(refreshToken);
      if (payload?.userId) {
        await deleteRefreshSession(payload.userId);
      }
    }

    res.clearCookie('refreshToken', cookieOptions);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('[Logout Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
