import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { hashToken, getFrontendBaseUrl } from '../utils/crypto.js';
import { promises as fs } from 'fs';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { Router, Request, Response } from 'express';
import { and, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { refreshTokens } from '../services/auth.js';
import { createAndSendOtp, verifyOtp } from '../services/otp.js';
import { SignupPayload, LoginPayload } from '../types/index.js';
import { redis, setRefreshSession, deleteRefreshSession } from '../config/redis.js';
import { logoutRevoke, authenticateToken } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { backupCodes, loginEvents, otpCodes, passwordResetTokens, users } from '../db/schema.js';
import { queueEmail } from '../services/email.js';
import { validatePassword } from '../utils/password.js';
import { addUsername, mightExist, validateName } from '../utils/bloomFilter.js';
import {
  generateAccessToken,
  generateRefreshToken,
  generateTwoFactorPendingToken,
  verifyRefreshToken,
  verifyTwoFactorPendingToken,
} from '../utils/jwt.js';
import {
  createSessionForAccessToken,
  extractAccessToken,
  getClientIp,
  hashSessionToken,
  invalidateAllSessionsForUser,
  listActiveSessionsForUser,
  markSessionSuspiciousVerified,
  parseUserAgent,
  revokeAllSessionsForUser,
  revokeSessionById,
  revokeSessionByTokenHash,
} from '../services/session.js';
import {
  passwordResetLimiter,
  loginLimiter,
  otpLimiter,
  strictLimiter,
} from '../lib/rate-limiters.js';
import { decrypt, encrypt } from '../lib/encryption.js';
import { analyzeLogin } from '../services/login-analyzer.js';
import {
  buildOtpUri,
  buildQrCodeDataUrl,
  formatManualEntryKey,
  generateTwoFactorSecret,
  getTwoFactorSetupTtlSeconds,
  twoFactorPendingLoginKey,
  twoFactorPendingSetupKey,
  twoFactorUsedCodeKey,
  verifyTotpToken,
} from '../services/two-factor.js';

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
const TWO_FACTOR_PENDING_LOGIN_WINDOW_SECONDS = 5 * 60;
const TWO_FACTOR_VALIDATE_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
const TWO_FACTOR_VALIDATE_RATE_LIMIT_MAX = 5;
const LOGIN_FAILURE_CAPTCHA_THRESHOLD = 3;
const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
const DUMMY_BCRYPT_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.6u9N5R16/fsoNqd7qV3CyMfCVxY2ByW';
const APP_NAME = process.env.TOTP_APP_NAME || 'Meetour';
const AVATAR_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_UPLOAD_DIR = path.resolve('uploads/avatars');
const OAUTH_LINK_STATE_WINDOW_SECONDS = 10 * 60;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sanitizeProfileName(name: string): string {
  return name
    .replace(/<[^>]*>/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return '***';
  }
  return `${parts[0][0]}***@${parts[1]}`;
}

function isLocalAvatarPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('/uploads/avatars/');
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMimes.has(file.mimetype)) {
      cb(new Error('INVALID_FILE_TYPE'));
      return;
    }
    cb(null, true);
  },
});

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
    .where(and(eq(passwordResetTokens.userId, input.userId), isNull(passwordResetTokens.usedAt)));

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
  options?: { suspiciousVerifiedAt?: Date | null },
): Promise<void> {
  await setRefreshSession(userId, hashToken(refreshToken));
  res.cookie('refreshToken', refreshToken, cookieOptions);
  await createSessionForAccessToken(userId, accessToken, req, options);
}

function lockoutDurationMsForAttempts(attempts: number): number {
  if (attempts >= 20) return 24 * 60 * 60 * 1000;
  if (attempts >= 15) return 2 * 60 * 60 * 1000;
  if (attempts >= 10) return 30 * 60 * 1000;
  if (attempts >= 5) return 5 * 60 * 1000;
  return 0;
}

function lockoutSecondsForAttempts(attempts: number): number {
  return Math.ceil(lockoutDurationMsForAttempts(attempts) / 1000);
}

function accountLockRedisKey(userId: string): string {
  return `account:locked:${userId}`;
}

function loginFailureIpKey(ipAddress: string): string {
  return `login:ipfail:${ipAddress}`;
}

function twoFactorValidateRateLimitKey(userId: string): string {
  return `ratelimit:2fa-validate:${userId}`;
}

function maskIpAddress(ip: string | null): string {
  if (!ip) return 'Unknown';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  return ip;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'LOGIN_FROM_NEW_COUNTRY':
      return "You're signing in from a new country";
    case 'NEW_DEVICE':
      return "This is a new device we haven't seen before";
    case 'IMPOSSIBLE_TRAVEL':
      return 'This location seems far from your recent activity';
    case 'LOGIN_AFTER_LONG_ABSENCE':
      return 'This login follows a long period of inactivity';
    case 'UNUSUAL_LOGIN_TIME':
      return 'The sign-in time is unusual for your account';
    case 'TOR_EXIT_NODE':
      return 'Sign-in originated from a Tor exit node';
    default:
      return reason;
  }
}

async function incrementLoginFailureIpCounter(ipAddress: string): Promise<number> {
  const key = loginFailureIpKey(ipAddress);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOGIN_FAILURE_WINDOW_SECONDS);
  }
  return count;
}

async function clearLoginFailureIpCounter(ipAddress: string): Promise<void> {
  await redis.del(loginFailureIpKey(ipAddress));
}

async function shouldRequireCaptcha(ipAddress: string): Promise<boolean> {
  const raw = await redis.get(loginFailureIpKey(ipAddress));
  const failures = raw ? Number(raw) : 0;
  return Number.isFinite(failures) && failures > LOGIN_FAILURE_CAPTCHA_THRESHOLD;
}

async function verifyCaptchaToken(captchaToken: string): Promise<boolean> {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    return false;
  }
  try {
    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        secret,
        response: captchaToken,
      }),
    });
    if (!response.ok) {
      return false;
    }
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

async function generateBackupCodesForUser(
  userId: string,
): Promise<{ formattedCodes: string[]; generatedAt: Date }> {
  const generatedAt = new Date();
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

    await tx.update(users).set({ backupCodesGeneratedAt: generatedAt }).where(eq(users.id, userId));
  });

  return {
    formattedCodes: generatedCodes.map((code) => code.formatted),
    generatedAt,
  };
}

async function markAccountLockInRedis(userId: string, lockedUntil: Date): Promise<void> {
  const remainingSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  await redis.set(accountLockRedisKey(userId), lockedUntil.toISOString(), {
    ex: remainingSeconds,
  });
}

async function clearAccountLockState(userId: string): Promise<void> {
  await redis.del(accountLockRedisKey(userId));
}

async function getActiveLockFromRedis(userId: string): Promise<Date | null> {
  const lockedUntil = await redis.get(accountLockRedisKey(userId));
  if (!lockedUntil) {
    return null;
  }
  const parsed = new Date(String(lockedUntil));
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    await clearAccountLockState(userId);
    return null;
  }
  return parsed;
}

async function completeSuccessfulLogin(input: {
  req: Request;
  res: Response;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    emailVerified: boolean;
  };
}): Promise<{
  accessToken: string;
  requiresSuspiciousLoginVerification: boolean;
  reasons: string[];
}> {
  const { req, user } = input;
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    email: user.email,
  });
  const ipAddress = getClientIp(req) ?? 'unknown';
  const parsedAgent = parseUserAgent(req.headers['user-agent']);

  const analysis = await analyzeLogin({
    userId: user.id,
    ipAddress,
    userAgent: req.headers['user-agent'] || '',
    country: parsedAgent.country ?? '',
    city: parsedAgent.city ?? '',
    browser: parsedAgent.browser ?? '',
    os: parsedAgent.os ?? '',
    deviceType: parsedAgent.deviceType,
  });

  const requiresSuspiciousVerification = analysis.riskScore >= 80;
  const sessionResult = await createSessionForAccessToken(user.id, accessToken, req, {
    suspiciousVerifiedAt: requiresSuspiciousVerification ? null : new Date(),
  });
  if (!requiresSuspiciousVerification) {
    await setRefreshSession(user.id, hashToken(refreshToken));
    input.res.cookie('refreshToken', refreshToken, cookieOptions);
  }

  const shouldSendAlert = analysis.riskScore >= 60;
  let alertSent = false;
  if (shouldSendAlert) {
    try {
      await queueEmail({
        to: user.email,
        template: 'suspicious_login',
        data: {
          userName: user.name,
          city: sessionResult.deviceInfo.city || 'Unknown',
          country: sessionResult.deviceInfo.country || 'Unknown',
          browser: sessionResult.deviceInfo.browser || 'Unknown',
          os: sessionResult.deviceInfo.os || 'Unknown',
          ipAddress,
          loginTime: new Date().toISOString(),
          reasons: analysis.reasons.map(reasonLabel),
          revokeUrl: `${getFrontendBaseUrl()}/settings/security`,
        },
      });
      alertSent = true;
    } catch (emailError) {
      console.error('[Suspicious Login Alert Email Error]', emailError);
    }
  }

  await db.insert(loginEvents).values({
    userId: user.id,
    sessionId: sessionResult.sessionId,
    ipAddress,
    country: sessionResult.deviceInfo.country,
    city: sessionResult.deviceInfo.city,
    deviceFingerprint: analysis.deviceFingerprint,
    browser: sessionResult.deviceInfo.browser,
    os: sessionResult.deviceInfo.os,
    deviceType: sessionResult.deviceInfo.deviceType,
    isSuspicious: analysis.isSuspicious,
    suspiciousReasons: analysis.reasons,
    alertSent,
  });

  return {
    accessToken,
    requiresSuspiciousLoginVerification: requiresSuspiciousVerification,
    reasons: analysis.reasons,
  };
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
        googleId: users.googleId,
        googleLinkedAt: users.googleLinkedAt,
        googleEmail: users.googleEmail,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorEnabledAt: users.twoFactorEnabledAt,
        recoveryEmail: users.recoveryEmail,
        recoveryEmailVerified: users.recoveryEmailVerified,
        backupCodesGeneratedAt: users.backupCodesGeneratedAt,
        passwordHash: users.passwordHash,
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
    const pendingEmail = await redis.get(`email:pending:${userId}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        googleLinked: Boolean(user.googleId),
        googleLinkedAt: user.googleLinkedAt,
        googleEmail: user.googleEmail,
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorEnabledAt: user.twoFactorEnabledAt,
        recoveryEmail: user.recoveryEmail,
        recoveryEmailVerified: user.recoveryEmailVerified,
        backupCodesGeneratedAt: user.backupCodesGeneratedAt,
        backupCodesRemaining: Number(remainingCodesResult?.count ?? 0),
        hasPassword: Boolean(user.passwordHash),
        pendingEmail,
        restrictedSession: req.restrictedSession === true,
      },
    });
  } catch (error) {
    console.error('[Auth Me Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/profile', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
    const name = sanitizeProfileName(rawName);

    if (name.length < 2 || name.length > 100) {
      res.status(400).json({ error: 'INVALID_NAME' });
      return;
    }

    const [updatedUser] = await db
      .update(users)
      .set({ name })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
      });

    if (!updatedUser) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    res.status(200).json({ user: updatedUser });
  } catch (error) {
    console.error('[Update Profile Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profile/avatar', authenticateToken, (req: Request, res: Response): void => {
  avatarUpload.single('avatar')(req, res, async (uploadError: unknown) => {
    try {
      if (uploadError) {
        if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: 'FILE_TOO_LARGE' });
          return;
        }
        const message = uploadError instanceof Error ? uploadError.message : 'INVALID_FILE';
        res.status(400).json({ error: message });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'AVATAR_FILE_REQUIRED' });
        return;
      }

      const metadata = await sharp(file.buffer).metadata();
      const allowedFormats = new Set(['jpeg', 'png', 'webp']);
      if (!metadata.format || !allowedFormats.has(metadata.format)) {
        res.status(400).json({ error: 'INVALID_IMAGE_CONTENT' });
        return;
      }

      const processedBuffer = await sharp(file.buffer)
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer();

      const userId = req.user!.id;
      const [user] = await db
        .select({
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      await fs.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
      const fileName = `avatar-${userId}-${Date.now()}.webp`;
      const filePath = path.join(AVATAR_UPLOAD_DIR, fileName);
      await fs.writeFile(filePath, processedBuffer);
      const avatarUrl = `/uploads/avatars/${fileName}`;

      if (isLocalAvatarPath(user?.avatarUrl)) {
        const previousPath = path.resolve(user.avatarUrl.replace(/^\//, ''));
        if (previousPath !== filePath) {
          await fs.unlink(previousPath).catch(() => undefined);
        }
      }

      await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));
      res.status(200).json({ avatarUrl });
    } catch (error) {
      console.error('[Upload Avatar Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

router.delete(
  '/profile/avatar',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const [user] = await db
        .select({
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (isLocalAvatarPath(user?.avatarUrl)) {
        const avatarPath = path.resolve(user.avatarUrl.replace(/^\//, ''));
        await fs.unlink(avatarPath).catch(() => undefined);
      }

      await db.update(users).set({ avatarUrl: null }).where(eq(users.id, userId));
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Delete Avatar Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.patch(
  '/profile/password',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const currentPassword =
        typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'CURRENT_AND_NEW_PASSWORD_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user.passwordHash) {
        res.status(400).json({ error: 'PASSWORD_AUTH_NOT_AVAILABLE' });
        return;
      }

      const validCurrentPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!validCurrentPassword) {
        res.status(401).json({ error: 'INVALID_CURRENT_PASSWORD' });
        return;
      }

      if (currentPassword === newPassword) {
        res.status(400).json({ error: 'NEW_PASSWORD_MUST_BE_DIFFERENT' });
        return;
      }

      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.valid) {
        res.status(400).json({
          error: 'WEAK_PASSWORD',
          requirements: passwordValidation.errors,
        });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await revokeAllSessionsForUser(userId, req.authTokenHash ?? null);

      try {
        await queueEmail({
          to: user.email,
          template: 'profile_password_changed',
          data: {
            userName: user.name,
          },
        });
      } catch (emailError) {
        console.error('[Profile Password Changed Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Change Password Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.patch(
  '/profile/email',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const newEmail =
        typeof req.body?.newEmail === 'string' ? normalizeEmail(req.body.newEmail) : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!newEmail || !password || !isValidEmailFormat(newEmail)) {
        res.status(400).json({ error: 'INVALID_INPUT' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user.passwordHash) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      if (normalizeEmail(user.email) === newEmail) {
        res.status(400).json({ error: 'EMAIL_UNCHANGED' });
        return;
      }

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${newEmail}`)
        .limit(1);
      if (existing) {
        res.status(409).json({ error: 'EMAIL_EXISTS' });
        return;
      }

      await db.update(users).set({ emailVerified: false }).where(eq(users.id, userId));
      await redis.set(`email:pending:${userId}`, newEmail, { ex: 3600 });
      await createAndSendOtp(newEmail);

      res.status(200).json({ message: 'Verify your new email to confirm the change' });
    } catch (error) {
      console.error('[Change Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get(
  '/profile/email/pending',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pendingEmail = await redis.get(`email:pending:${req.user!.id}`);
      res.status(200).json({ pendingEmail });
    } catch (error) {
      console.error('[Pending Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/profile/email/verify',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
        return;
      }

      const pendingEmail = await redis.get(`email:pending:${userId}`);
      if (!pendingEmail) {
        res.status(400).json({ error: 'NO_PENDING_EMAIL_CHANGE' });
        return;
      }

      const verified = await verifyOtp(String(pendingEmail), otp);
      if (!verified) {
        res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
        return;
      }

      await db
        .update(users)
        .set({
          email: String(pendingEmail),
          emailVerified: true,
        })
        .where(eq(users.id, userId));
      await redis.del(`email:pending:${userId}`);

      res.status(200).json({ success: true, email: pendingEmail });
    } catch (error) {
      console.error('[Verify Changed Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get(
  '/link-google',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const stateToken = randomBytes(16).toString('hex');
      await redis.set(`oauth:link-state:${stateToken}`, req.user!.id, {
        ex: OAUTH_LINK_STATE_WINDOW_SECONDS,
      });
      res.redirect(`/api/oauth/google?state=${encodeURIComponent(`link:${stateToken}`)}`);
    } catch (error) {
      console.error('[Initiate Google Link Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get('/link-google/pending', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'LINK_TOKEN_REQUIRED' });
      return;
    }

    const payloadRaw = await redis.get(`oauth:pending:${token}`);
    if (!payloadRaw) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }

    const payload = JSON.parse(String(payloadRaw)) as {
      googleEmail: string;
      name: string;
      avatar?: string | null;
      existingUserId: string;
    };

    const [existingUser] = await db
      .select({
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, payload.existingUserId))
      .limit(1);
    if (!existingUser) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }

    res.status(200).json({
      google: {
        email: payload.googleEmail,
        name: payload.name,
        avatarUrl: payload.avatar || null,
      },
      existing: existingUser,
    });
  } catch (error) {
    console.error('[Get Pending Google Link Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/link-google/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const linkToken = typeof req.body?.linkToken === 'string' ? req.body.linkToken.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!linkToken || !password) {
      res.status(400).json({ error: 'LINK_TOKEN_AND_PASSWORD_REQUIRED' });
      return;
    }

    const payloadRaw = await redis.get(`oauth:pending:${linkToken}`);
    if (!payloadRaw) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }

    const payload = JSON.parse(String(payloadRaw)) as {
      googleId: string;
      googleEmail: string;
      name: string;
      avatar?: string | null;
      existingUserId: string;
    };

    const [existingUser] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, payload.existingUserId))
      .limit(1);
    if (!existingUser || existingUser.deletedAt) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }
    if (!existingUser.passwordHash) {
      res.status(400).json({ error: 'PASSWORD_REQUIRED_FOR_LINKING' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, existingUser.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    await db
      .update(users)
      .set({
        googleId: payload.googleId,
        googleLinkedAt: new Date(),
        googleEmail: payload.googleEmail,
        avatarUrl: existingUser.avatarUrl ?? payload.avatar ?? null,
      })
      .where(eq(users.id, existingUser.id));
    await redis.del(`oauth:pending:${linkToken}`);

    const accessToken = generateAccessToken({
      userId: existingUser.id,
      email: existingUser.email,
    });
    const refreshToken = generateRefreshToken({
      userId: existingUser.id,
      email: existingUser.email,
    });
    await attachAuthSession(req, res, existingUser.id, accessToken, refreshToken);

    try {
      await queueEmail({
        to: existingUser.email,
        template: 'google_linked',
        data: {
          userName: existingUser.name,
          googleEmail: payload.googleEmail,
        },
      });
    } catch (emailError) {
      console.error('[Google Linked Email Error]', emailError);
    }

    res.status(200).json({
      user: {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        emailVerified: existingUser.emailVerified,
        avatarUrl: existingUser.avatarUrl ?? payload.avatar ?? null,
      },
      accessToken,
      message: 'Google account linked successfully',
    });
  } catch (error) {
    console.error('[Confirm Google Link Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete(
  '/unlink-google',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password) {
        res.status(400).json({ error: 'PASSWORD_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
          googleId: users.googleId,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }
      if (!user.passwordHash) {
        res.status(400).json({
          error: 'NO_PASSWORD_SET',
          message: 'Set a password before unlinking Google',
        });
        return;
      }
      if (!user.googleId) {
        res.status(400).json({ error: 'GOOGLE_NOT_LINKED' });
        return;
      }

      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      await db
        .update(users)
        .set({
          googleId: null,
          googleLinkedAt: null,
          googleEmail: null,
        })
        .where(eq(users.id, userId));

      try {
        await queueEmail({
          to: user.email,
          template: 'google_unlinked',
          data: {
            userName: user.name,
          },
        });
      } catch (emailError) {
        console.error('[Google Unlinked Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Unlink Google Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/set-password',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (!newPassword) {
        res.status(400).json({ error: 'PASSWORD_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
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
        res.status(400).json({ error: 'PASSWORD_ALREADY_SET' });
        return;
      }

      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.valid) {
        res.status(400).json({
          error: 'WEAK_PASSWORD',
          requirements: passwordValidation.errors,
        });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

      try {
        await queueEmail({
          to: user.email,
          template: 'password_added',
          data: {
            userName: user.name,
          },
        });
      } catch (emailError) {
        console.error('[Password Added Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Set Password Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

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
    console.error('[Verify Email Error]', error);
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
          console.error('[Forgot Password Email Error]', emailError);
        }
      }

      res.status(isRateLimited ? 429 : 200).json({ message: FORGOT_PASSWORD_SUCCESS_MESSAGE });
    } catch (error) {
      console.error('[Forgot Password Error]', error);
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
    console.error('[Validate Reset Token Error]', error);
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
      console.error('[Reset Password Success Email Error]', emailError);
    }

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[Reset Password Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
          console.error('[Account Lockout Email Error]', emailError);
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
        console.error('[Account Recovered Email Error]', emailError);
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

router.post(
  '/sessions/revoke-all',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

router.get(
  '/backup-codes/status',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

router.post(
  '/backup-codes/generate',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

router.post(
  '/recovery-email/add',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

router.post(
  '/recovery-email/resend',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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
        res.status(429).json({
          error: 'TOO_MANY_ATTEMPTS',
          retryAfter: rateLimit.retryAfter,
        });
        return;
      }

      await createAndSendOtp(user.recoveryEmail);
      res.status(200).json({ message: 'Verification sent to recovery email' });
    } catch (error) {
      console.error('[Resend Recovery Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/recovery-email/verify',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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

      await db.update(users).set({ recoveryEmailVerified: true }).where(eq(users.id, userId));
      await redis.del(verifyAttemptsKey);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Verify Recovery Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.delete(
  '/recovery-email',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
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
        console.error('[Recovery Email Reset Dispatch Error]', emailError);
      }
    }

    res.status(200).json({ message: RECOVERY_GENERIC_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[Recover With Recovery Email Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/setup', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
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
    console.error('[2FA Setup Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/2fa/verify-setup',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
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
          console.error('[2FA Enabled Email Error]', emailError);
        }
      }

      res.status(200).json({
        success: true,
        backupCodes: backupCodesResult.formattedCodes,
      });
    } catch (error) {
      console.error('[2FA Verify Setup Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/2fa/disable',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
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
        console.error('[2FA Disabled Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[2FA Disable Error]', error);
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
    console.error('[2FA Validate Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
