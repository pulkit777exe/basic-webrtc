import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Router, Request, Response } from 'express';
import { and, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { login, refreshTokens } from '../services/auth.js';
import { createAndSendOtp, verifyOtp } from '../services/otp.js';
import { SignupPayload, LoginPayload } from '../types/index.js';
import { redis, setRefreshSession, deleteRefreshSession } from '../config/redis.js';
import { logoutRevoke, authenticateToken } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { backupCodes, otpCodes, passwordResetTokens, users } from '../db/schema.js';
import { queueEmail } from '../services/email.js';
import { validatePassword } from '../utils/password.js';
import { validateName } from '../utils/bloomFilter.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';
import {
  createSessionForAccessToken,
  extractAccessToken,
  getClientIp,
  hashSessionToken,
  invalidateAllSessionsForUser,
  listActiveSessionsForUser,
  revokeAllSessionsForUser,
  revokeSessionById,
  revokeSessionByTokenHash,
} from '../services/session.js';

const router = Router();
const FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS = 3600;
const FORGOT_PASSWORD_MAX_REQUESTS_PER_WINDOW = 3;
const RESET_TOKEN_EXPIRY_MINUTES = 60;
const FORGOT_PASSWORD_SUCCESS_MESSAGE = 'If that email exists, we sent a reset link';
const OTP_ATTEMPT_MAX = 5;
const OTP_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const RESEND_VERIFICATION_MAX = 3;
const RESEND_VERIFICATION_WINDOW_SECONDS = 60 * 60;
const SIGNUP_PASSWORD_HASH_ROUNDS = 10;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_RECOVERY_MAX_ATTEMPTS = 5;
const BACKUP_CODE_RECOVERY_WINDOW_SECONDS = 60 * 60;
const RECOVERY_EMAIL_RECOVERY_MAX_ATTEMPTS = 3;
const RECOVERY_EMAIL_RECOVERY_WINDOW_SECONDS = 60 * 60;
const RECOVERY_EMAIL_VERIFY_MAX_ATTEMPTS = 5;
const RECOVERY_EMAIL_VERIFY_WINDOW_SECONDS = 15 * 60;
const RECOVERY_GENERIC_SUCCESS_MESSAGE = 'If a recovery email is set, we sent a link';
const RECOVERY_EMAIL_RESEND_MAX = 3;
const RECOVERY_EMAIL_RESEND_WINDOW_SECONDS = 60 * 60;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return '***';
  }
  return `${parts[0][0]}***@${parts[1]}`;
}

function normalizeBackupCode(code: string): string {
  return code.replaceAll('-', '').trim().toUpperCase();
}

function formatBackupCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function isValidEmailFormat(value: string): boolean {
  return value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

async function applyRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<{ limited: boolean; retryAfter: number }> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > maxAttempts) {
    const retryAfter = Math.max(0, await redis.ttl(key));
    return { limited: true, retryAfter };
  }
  return { limited: false, retryAfter: 0 };
}

function getFrontendBaseUrl(): string {
  const envBaseUrl =
    process.env.BASE_URL ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.ALLOWED_ORIGINS?.split(',')[0] ||
    'http://localhost:3000';
  return envBaseUrl.replace(/\/$/, '');
}

async function createAndQueuePasswordResetEmail(input: {
  userId: string;
  userName: string;
  deliveryEmail: string;
  req: Request;
}): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
  const ipAddress = getClientIp(input.req);

  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(passwordResetTokens.userId, input.userId),
        isNull(passwordResetTokens.usedAt),
      ),
    );

  await db.insert(passwordResetTokens).values({
    userId: input.userId,
    tokenHash,
    expiresAt,
    ipAddress,
  });

  const resetUrl = `${getFrontendBaseUrl()}/auth/reset-password?token=${token}`;
  await queueEmail({
    to: input.deliveryEmail,
    template: 'password_reset',
    data: {
      resetUrl,
      userName: input.userName,
      expiresInMinutes: RESET_TOKEN_EXPIRY_MINUTES,
      ipAddress: ipAddress ?? undefined,
    },
  });
}

async function attachAuthSession(
  req: Request,
  res: Response,
  userId: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await setRefreshSession(userId, hashToken(refreshToken));
  res.cookie('refreshToken', refreshToken, cookieOptions);
  await createSessionForAccessToken(userId, accessToken, req);
}

async function getPasswordValidationErrors(
  newPassword: string,
  currentPasswordHash: string | null,
): Promise<string[]> {
  const requirements: string[] = [];
  if (newPassword.length < 8) {
    requirements.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(newPassword)) {
    requirements.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(newPassword)) {
    requirements.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(newPassword)) {
    requirements.push('Password must contain at least one number');
  }
  if (currentPasswordHash) {
    const isSameAsCurrent = await bcrypt.compare(newPassword, currentPasswordHash);
    if (isSameAsCurrent) {
      requirements.push('New password must be different from your current password');
    }
  }
  return requirements;
}

function validateSignupPayload(payload: SignupPayload): string[] {
  const errors: string[] = [];
  const email = payload.email?.trim();
  const name = payload.name?.trim() || '';
  const password = payload.password ?? '';

  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Invalid email address');
  }

  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    errors.push(...nameValidation.errors);
  }
  if (!name || name.length < 2 || name.length > 100) {
    errors.push('Name must be between 2 and 100 characters');
  }
  if (/<[^>]+>/.test(name)) {
    errors.push('Name cannot contain HTML');
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    errors.push(...passwordValidation.errors);
  }

  return Array.from(new Set(errors));
}

function mapUserForAuthResponse(user: {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}): {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
} {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    avatarUrl: user.avatarUrl,
  };
}

router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
        recoveryEmail: users.recoveryEmail,
        recoveryEmailVerified: users.recoveryEmailVerified,
        backupCodesGeneratedAt: users.backupCodesGeneratedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }
    const [remainingCodesResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backupCodes)
      .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        recoveryEmail: user.recoveryEmail,
        recoveryEmailVerified: user.recoveryEmailVerified,
        backupCodesGeneratedAt: user.backupCodesGeneratedAt,
        backupCodesRemaining: Number(remainingCodesResult?.count ?? 0),
      },
    });
  } catch (error) {
    console.error('[Auth Me Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    await createAndSendOtp(normalizedEmail);
    res.status(200).json({
      status: 'verification_required',
      message: 'Check your email',
    });
  } catch (error) {
    console.error('[Signup Error]', error);
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
    console.error('[Resend Verification Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const emailInput = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const otpInput = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

    if (!emailInput || !/^\d{6}$/.test(otpInput)) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
      return;
    }

    const attemptsKey = `ratelimit:otp:${emailInput}`;
    const existingAttempts = Number(await redis.get(attemptsKey) || 0);
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
      await tx.update(users).set({ emailVerified: true }).where(sql`lower(${users.email}) = ${emailInput}`);
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
    console.error('[Verify Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const emailInput =
      typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
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
        console.error('[Forgot Password Email Error]', emailError);
      }
    }

    res
      .status(isRateLimited ? 429 : 200)
      .json({ message: FORGOT_PASSWORD_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[Forgot Password Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    console.error('[Validate Reset Token Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const newPassword =
      typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

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
        .set({ passwordHash: newPasswordHash })
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
      console.error('[Reset Password Success Email Error]', emailError);
    }

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[Reset Password Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload: LoginPayload = req.body;
    const result = await login(payload);

    if (!result) {
      res.status(401).json({ error: 'Invalid credentials', code: 'UNAUTHORIZED' });
      return;
    }

    if (!result.user.emailVerified) {
      res.status(403).json({
        error: 'Email not verified',
        user: result.user,
        code: 'EMAIL_NOT_VERIFIED',
      });
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
    console.error('[Login Error]', error);
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
    console.error('[Refresh Error]', error);
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

    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Logout Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sessions', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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
      const userId = req.user!.id;
      const { sessionId } = req.params;
      const result = await revokeSessionById(userId, sessionId);
      if (!result.success || !result.tokenHash) {
        res.status(404).json({ error: 'SESSION_NOT_FOUND' });
        return;
      }

      const isCurrent = req.authTokenHash === result.tokenHash;
      if (isCurrent) {
        res.clearCookie('refreshToken');
      }

      res.status(200).json({ success: true, currentSessionRevoked: isCurrent });
    } catch (error) {
      console.error('[Session Revoke Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post('/sessions/revoke-all', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const exceptCurrent = parseBoolean(req.body?.exceptCurrent);
    const currentTokenHash = req.authTokenHash ?? null;
    const revokedCount = await revokeAllSessionsForUser(
      userId,
      exceptCurrent ? currentTokenHash : null,
    );

    if (!exceptCurrent) {
      await deleteRefreshSession(userId);
      res.clearCookie('refreshToken');
    }

    res.status(200).json({ revokedCount });
  } catch (error) {
    console.error('[Sessions Revoke All Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/backup-codes/status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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
});

router.post('/backup-codes/generate', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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

    const now = new Date();
    const generatedCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString('hex').toUpperCase();
      const formatted = formatBackupCode(raw);
      const hash = createHash('sha256').update(raw).digest('hex');
      return { formatted, hash };
    });

    await db.transaction(async (tx) => {
      await tx
        .delete(backupCodes)
        .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));

      await tx.insert(backupCodes).values(
        generatedCodes.map((code) => ({
          userId,
          codeHash: code.hash,
        })),
      );

      await tx
        .update(users)
        .set({ backupCodesGeneratedAt: now })
        .where(eq(users.id, userId));
    });

    res.status(200).json({
      codes: generatedCodes.map((code) => code.formatted),
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('[Generate Backup Codes Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/recover/backup-code', async (req: Request, res: Response): Promise<void> => {
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
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfter: rateLimit.retryAfter });
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

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });
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
      console.error('[Backup Code Alert Email Error]', emailError);
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
    console.error('[Backup Code Recovery Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/recovery-email/add', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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
    console.error('[Add Recovery Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/recovery-email/resend', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfter: rateLimit.retryAfter });
      return;
    }

    await createAndSendOtp(user.recoveryEmail);
    res.status(200).json({ message: 'Verification sent to recovery email' });
  } catch (error) {
    console.error('[Resend Recovery Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/recovery-email/verify', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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

    await db
      .update(users)
      .set({ recoveryEmailVerified: true })
      .where(eq(users.id, userId));
    await redis.del(verifyAttemptsKey);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Verify Recovery Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/recovery-email', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    await db
      .update(users)
      .set({
        recoveryEmail: null,
        recoveryEmailVerified: false,
      })
      .where(eq(users.id, userId));

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Remove Recovery Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
        console.error('[Recovery Email Reset Dispatch Error]', emailError);
      }
    }

    res.status(200).json({ message: RECOVERY_GENERIC_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[Recover With Recovery Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
