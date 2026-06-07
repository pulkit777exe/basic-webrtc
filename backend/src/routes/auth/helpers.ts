import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { hashToken, getFrontendBaseUrl } from '../../utils/crypto.js';
import { redis, setRefreshSession } from '../../config/redis.js';
import { db } from '../../db/index.js';
import { backupCodes, loginEvents, passwordResetTokens, users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { analyzeLogin } from '../../services/login-analyzer.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt.js';
import { createSessionForAccessToken, getClientIp, parseUserAgent } from '../../services/session.js';
import { validateName } from '../../utils/bloomFilter.js';
import { validatePassword } from '../../utils/password.js';
import { SignupPayload } from '../../types/index.js';
import {
  RESET_TOKEN_EXPIRY_MINUTES,
  LOGIN_FAILURE_CAPTCHA_THRESHOLD,
  LOGIN_FAILURE_WINDOW_SECONDS,
  BACKUP_CODE_COUNT,
  cookieOptions,
} from './constants.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function sanitizeProfileName(name: string): string {
  return name
    .replace(/<[^>]*>/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return '***';
  }
  return `${parts[0][0]}***@${parts[1]}`;
}

export function isLocalAvatarPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('/uploads/avatars/');
}

export function normalizeBackupCode(code: string): string {
  return code.replaceAll('-', '').trim().toUpperCase();
}

export function formatBackupCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function isValidEmailFormat(value: string): boolean {
  return value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

export async function applyRateLimit(
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

export async function createAndQueuePasswordResetEmail(input: {
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

export async function attachAuthSession(
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

export function lockoutDurationMsForAttempts(attempts: number): number {
  if (attempts >= 20) return 24 * 60 * 60 * 1000;
  if (attempts >= 15) return 2 * 60 * 60 * 1000;
  if (attempts >= 10) return 30 * 60 * 1000;
  if (attempts >= 5) return 5 * 60 * 1000;
  return 0;
}

export function lockoutSecondsForAttempts(attempts: number): number {
  return Math.ceil(lockoutDurationMsForAttempts(attempts) / 1000);
}

export function accountLockRedisKey(userId: string): string {
  return `account:locked:${userId}`;
}

export function loginFailureIpKey(ipAddress: string): string {
  return `login:ipfail:${ipAddress}`;
}

export function twoFactorValidateRateLimitKey(userId: string): string {
  return `ratelimit:2fa-validate:${userId}`;
}

export function maskIpAddress(ip: string | null): string {
  if (!ip) return 'Unknown';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  return ip;
}

export function reasonLabel(reason: string): string {
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

export async function incrementLoginFailureIpCounter(ipAddress: string): Promise<number> {
  const key = loginFailureIpKey(ipAddress);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, LOGIN_FAILURE_WINDOW_SECONDS);
  }
  return count;
}

export async function clearLoginFailureIpCounter(ipAddress: string): Promise<void> {
  await redis.del(loginFailureIpKey(ipAddress));
}

export async function shouldRequireCaptcha(ipAddress: string): Promise<boolean> {
  const raw = await redis.get(loginFailureIpKey(ipAddress));
  const failures = raw ? Number(raw) : 0;
  return Number.isFinite(failures) && failures > LOGIN_FAILURE_CAPTCHA_THRESHOLD;
}

export async function verifyCaptchaToken(captchaToken: string): Promise<boolean> {
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

export async function generateBackupCodesForUser(
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

export async function markAccountLockInRedis(userId: string, lockedUntil: Date): Promise<void> {
  const remainingSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  await redis.set(accountLockRedisKey(userId), lockedUntil.toISOString(), {
    ex: remainingSeconds,
  });
}

export async function clearAccountLockState(userId: string): Promise<void> {
  await redis.del(accountLockRedisKey(userId));
}

export async function getActiveLockFromRedis(userId: string): Promise<Date | null> {
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

export async function completeSuccessfulLogin(input: {
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

export async function getPasswordValidationErrors(
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

export function validateSignupPayload(payload: SignupPayload): string[] {
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

export function mapUserForAuthResponse(user: {
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
