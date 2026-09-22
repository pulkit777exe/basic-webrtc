import bcrypt from 'bcrypt';
import { getFrontendBaseUrl } from '../../utils/crypto.js';
import { Router, Request, Response } from 'express';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { createAndSendOtp } from '../../services/otp.js';
import { SignupPayload } from '../../types/index.js';
import { redis } from '../../config/redis.js';
import { db } from '../../db/index.js';
import { otpCodes, passwordResetTokens, users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { addUsername } from '../../utils/bloomFilter.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt.js';
import { getClientIp, invalidateAllSessionsForUser } from '../../services/session.js';
import { passwordResetLimiter, otpLimiter } from '../../lib/rate-limiters.js';
import { FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS, FORGOT_PASSWORD_MAX_REQUESTS_PER_WINDOW, FORGOT_PASSWORD_SUCCESS_MESSAGE, OTP_ATTEMPT_MAX, OTP_ATTEMPT_WINDOW_SECONDS, RESEND_VERIFICATION_MAX, RESEND_VERIFICATION_WINDOW_SECONDS, SIGNUP_PASSWORD_HASH_ROUNDS, normalizeEmail, hashResetToken, maskEmail, createAndQueuePasswordResetEmail, attachAuthSession, clearAccountLockState, getPasswordValidationErrors, validateSignupPayload, mapUserForAuthResponse } from './shared.js';
import { logger } from '../../lib/logger';

const router = Router();

router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload: SignupPayload = {
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      email: typeof req.body?.email === 'string' ? req.body.email : '',
      password: typeof req.body?.password === 'string' ? req.body.password : '',
    };
    const validationErrors = validateSignupPayload(payload);
    if (validationErrors.length > 0) {
      res.status(400).json({ errors: validationErrors });
      return;
    }
    const normalizedEmail = normalizeEmail(payload.email);
    const [existingUser] = await db
      .select({
        id: users.id,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existingUser?.emailVerified) {
      res.status(409).json({ error: 'EMAIL_EXISTS' });
      return;
    }

    if (existingUser && !existingUser.emailVerified) {
      await createAndSendOtp(normalizedEmail);
      res.status(200).json({
        status: 'verification_required',
        message: 'Check your email',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(payload.password, SIGNUP_PASSWORD_HASH_ROUNDS);
    await db.insert(users).values({
      name: payload.name.trim(),
      email: normalizedEmail,
      passwordHash,
      emailVerified: false,
    });
    addUsername(normalizedEmail.split('@')[0]);
    await createAndSendOtp(normalizedEmail);
    res.status(200).json({
      status: 'verification_required',
      message: 'Check your email',
    });
  } catch (error) {
    logger.error('[Signup Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-verification', async (req: Request, res: Response): Promise<void> => {
  try {
    const emailInput = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    if (!emailInput) {
      res.status(200).json({ message: 'Verification email sent' });
      return;
    }

    const resendKey = `ratelimit:resend-verification:${emailInput}`;
    const resendCount = await redis.incr(resendKey);
    if (resendCount === 1) {
      await redis.expire(resendKey, RESEND_VERIFICATION_WINDOW_SECONDS);
    }

    if (resendCount > RESEND_VERIFICATION_MAX) {
      const retryAfter = Math.max(0, await redis.ttl(resendKey));
      res.status(429).json({
        error: 'TOO_MANY_ATTEMPTS',
        retryAfter,
      });
      return;
    }

    const [user] = await db
      .select({
        id: users.id,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${emailInput}`)
      .limit(1);

    if (!user || user.emailVerified) {
      res.status(200).json({ message: 'Verification email sent' });
      return;
    }

    await createAndSendOtp(emailInput);
    res.status(200).json({ message: 'Verification email sent' });
  } catch (error) {
    logger.error('[Resend Verification Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-email', otpLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const emailInput = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const otpInput = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

    if (!emailInput || !/^\d{6}$/.test(otpInput)) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
      return;
    }

    const attemptsKey = `ratelimit:otp:${emailInput}`;
    const existingAttempts = Number((await redis.get(attemptsKey)) || 0);
    if (existingAttempts >= OTP_ATTEMPT_MAX) {
      const retryAfter = Math.max(0, await redis.ttl(attemptsKey));
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfter });
      return;
    }

    const [latestOtp] = await db
      .select({
        id: otpCodes.id,
        codeHash: otpCodes.code,
      })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.email, emailInput),
          eq(otpCodes.verified, false),
          gt(otpCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);

    if (!latestOtp) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
      return;
    }

    const isOtpValid = await bcrypt.compare(otpInput, latestOtp.codeHash);
    if (!isOtpValid) {
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) {
        await redis.expire(attemptsKey, OTP_ATTEMPT_WINDOW_SECONDS);
      }
      const attemptsLeft = Math.max(0, OTP_ATTEMPT_MAX - attempts);
      res.status(400).json({ error: 'INVALID_CODE', attemptsLeft });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(otpCodes).set({ verified: true }).where(eq(otpCodes.id, latestOtp.id));
      await tx
        .update(users)
        .set({ emailVerified: true })
        .where(sql`lower(${users.email}) = ${emailInput}`);
    });
    await redis.del(attemptsKey);

    const [verifiedUser] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${emailInput}`)
      .limit(1);

    if (!verifiedUser) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    const accessToken = generateAccessToken({
      userId: verifiedUser.id,
      email: verifiedUser.email,
    });
    const refreshToken = generateRefreshToken({
      userId: verifiedUser.id,
      email: verifiedUser.email,
    });
    await attachAuthSession(req, res, verifiedUser.id, accessToken, refreshToken);
    res.status(200).json({
      user: mapUserForAuthResponse(verifiedUser),
      accessToken,
    });
  } catch (error) {
    logger.error('[Verify Email Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/forgot-password',
  passwordResetLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const emailInput = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      if (!emailInput) {
        res.status(200).json({ message: FORGOT_PASSWORD_SUCCESS_MESSAGE });
        return;
      }

      const rateLimitKey = `ratelimit:forgot:${emailInput}`;
      const requestCount = await redis.incr(rateLimitKey);
      if (requestCount === 1) {
        await redis.expire(rateLimitKey, FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS);
      }
      const isRateLimited = requestCount > FORGOT_PASSWORD_MAX_REQUESTS_PER_WINDOW;

      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${emailInput}`)
        .limit(1);

      if (user && !isRateLimited) {
        try {
          await createAndQueuePasswordResetEmail({
            userId: user.id,
            userName: user.name,
            deliveryEmail: user.email,
            req,
          });
        } catch (emailError) {
          logger.error('[Forgot Password Email Error]', { err: emailError });
        }
      }

      res.status(isRateLimited ? 429 : 200).json({ message: FORGOT_PASSWORD_SUCCESS_MESSAGE });
    } catch (error) {
      logger.error('[Forgot Password Error]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get('/reset-password/validate', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) {
      res.json({ valid: false });
      return;
    }

    const tokenHash = hashResetToken(token);
    const [result] = await db
      .select({
        email: users.email,
      })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!result) {
      res.json({ valid: false });
      return;
    }

    res.json({
      valid: true,
      email: maskEmail(result.email),
    });
  } catch (error) {
    logger.error('[Validate Reset Token Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!token) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
      return;
    }

    const tokenHash = hashResetToken(token);
    const [resetRecord] = await db
      .select({
        userId: users.id,
        userEmail: users.email,
        userName: users.name,
        currentPasswordHash: users.passwordHash,
      })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!resetRecord) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
      return;
    }

    const requirements = await getPasswordValidationErrors(
      newPassword,
      resetRecord.currentPasswordHash,
    );
    if (requirements.length > 0) {
      res.status(400).json({ error: 'WEAK_PASSWORD', requirements });
      return;
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLoginAt: null,
        })
        .where(eq(users.id, resetRecord.userId));

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, resetRecord.userId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
    });

    await invalidateAllSessionsForUser(resetRecord.userId);
    await clearAccountLockState(resetRecord.userId);

    const ipAddress = getClientIp(req);
    const secureAccountUrl = `${getFrontendBaseUrl()}/auth/forgot-password`;
    try {
      await queueEmail({
        to: resetRecord.userEmail,
        template: 'password_reset_success',
        data: {
          userName: resetRecord.userName,
          timestamp: now.toISOString(),
          ipAddress: ipAddress ?? undefined,
          secureAccountUrl,
        },
      });
    } catch (emailError) {
      logger.error('[Reset Password Success Email Error]', { err: emailError });
    }

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    logger.error('[Reset Password Error]', { err: error });
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
