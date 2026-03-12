import { createHash } from 'crypto';
import type { Request } from 'express';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { redis, deleteRefreshSession } from '../config/redis.js';
import { db } from '../db/index.js';
import { userSessions } from '../db/schema.js';

const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const LAST_ACTIVE_DEBOUNCE_SECONDS = 5 * 60;

export interface ParsedDeviceInfo {
  deviceName: string | null;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string | null;
  os: string | null;
}

export interface SessionListItem {
  id: string;
  tokenHash: string;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  ipAddress: string | null;
  location: string | null;
  lastActiveAt: Date | null;
  createdAt: Date | null;
  isCurrent: boolean;
}

function sessionRedisKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

function lastActiveDebounceKey(tokenHash: string): string {
  return `lastactive:${tokenHash}`;
}

function sanitizeIp(rawIp: string | null | undefined): string | null {
  if (!rawIp) {
    return null;
  }
  const trimmed = rawIp.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

function getForwardedIp(req: Request): string | null {
  const header = req.headers['x-forwarded-for'];
  if (typeof header === 'string') {
    const first = header.split(',')[0];
    return sanitizeIp(first);
  }
  if (Array.isArray(header) && header.length > 0) {
    return sanitizeIp(header[0]);
  }
  return null;
}

function getRequestLocation(req: Request): string | null {
  const city = req.headers['x-vercel-ip-city'];
  const region = req.headers['x-vercel-ip-country-region'];
  const country = req.headers['x-vercel-ip-country'];
  const cityValue = typeof city === 'string' ? city.trim() : '';
  const regionValue = typeof region === 'string' ? region.trim() : '';
  const countryValue = typeof country === 'string' ? country.trim() : '';

  if (cityValue && countryValue) {
    return `${cityValue}, ${countryValue}`;
  }
  if (regionValue && countryValue) {
    return `${regionValue}, ${countryValue}`;
  }
  if (countryValue) {
    return countryValue;
  }
  return null;
}

function parseDeviceType(userAgent: string): ParsedDeviceInfo['deviceType'] {
  const ua = userAgent.toLowerCase();
  if (ua.includes('ipad') || ua.includes('tablet')) {
    return 'tablet';
  }
  if (
    ua.includes('mobile') ||
    ua.includes('android') ||
    ua.includes('iphone') ||
    ua.includes('ipod')
  ) {
    return 'mobile';
  }
  if (ua.length === 0) {
    return 'unknown';
  }
  return 'desktop';
}

function parseBrowser(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera/')) return 'Opera';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('safari/')) return 'Safari';
  return null;
}

function parseOs(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows nt')) return 'Windows';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'iOS';
  if (ua.includes('linux')) return 'Linux';
  return null;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getClientIp(req: Request): string | null {
  return getForwardedIp(req) ?? sanitizeIp(req.ip);
}

export function parseUserAgent(userAgentRaw: string | undefined): ParsedDeviceInfo {
  const userAgent = userAgentRaw ?? '';
  const browser = parseBrowser(userAgent);
  const os = parseOs(userAgent);
  const deviceType = parseDeviceType(userAgent);
  const deviceName = browser && os ? `${browser} on ${os}` : browser || os || null;

  return {
    deviceName,
    deviceType,
    browser,
    os,
  };
}

function getAccessTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (typeof req.cookies?.accessToken === 'string') {
    return req.cookies.accessToken;
  }
  if (typeof req.body?.accessToken === 'string') {
    return req.body.accessToken;
  }
  return null;
}

function ttlFromExpiry(expiresAt: Date): number {
  const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return Math.max(1, Math.min(DEFAULT_SESSION_TTL_SECONDS, ttl));
}

export function extractAccessToken(req: Request): string | null {
  return getAccessTokenFromHeader(req);
}

export async function createSessionForAccessToken(
  userId: string,
  token: string,
  req: Request,
): Promise<string> {
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + DEFAULT_SESSION_TTL_SECONDS * 1000);
  const deviceInfo = parseUserAgent(req.headers['user-agent']);
  const ipAddress = getClientIp(req);
  const location = getRequestLocation(req);

  await db.insert(userSessions).values({
    userId,
    tokenHash,
    deviceName: deviceInfo.deviceName,
    deviceType: deviceInfo.deviceType,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    ipAddress,
    location,
    expiresAt,
    lastActiveAt: new Date(),
  });

  await redis.set(sessionRedisKey(tokenHash), userId, 'EX', DEFAULT_SESSION_TTL_SECONDS);
  return tokenHash;
}

export async function validateSessionToken(
  userId: string,
  tokenHash: string,
): Promise<boolean> {
  const cachedUserId = await redis.get(sessionRedisKey(tokenHash));
  if (cachedUserId) {
    return cachedUserId === userId;
  }

  const [session] = await db
    .select({
      userId: userSessions.userId,
      revokedAt: userSessions.revokedAt,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .where(eq(userSessions.tokenHash, tokenHash))
    .limit(1);

  if (!session) {
    return false;
  }
  if (session.userId !== userId) {
    return false;
  }
  if (session.revokedAt) {
    return false;
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  await redis.set(
    sessionRedisKey(tokenHash),
    userId,
    'EX',
    ttlFromExpiry(session.expiresAt),
  );
  return true;
}

export async function touchSessionActivity(tokenHash: string): Promise<void> {
  await redis.expire(sessionRedisKey(tokenHash), DEFAULT_SESSION_TTL_SECONDS);
  const shouldUpdate = await redis.set(
    lastActiveDebounceKey(tokenHash),
    '1',
    'EX',
    LAST_ACTIVE_DEBOUNCE_SECONDS,
    'NX',
  );
  if (shouldUpdate !== 'OK') {
    return;
  }

  await db
    .update(userSessions)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)));
}

export async function revokeSessionByTokenHash(tokenHash: string): Promise<void> {
  const now = new Date();
  await db
    .update(userSessions)
    .set({ revokedAt: now, isCurrent: false })
    .where(and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)));
  await Promise.all([
    redis.del(sessionRedisKey(tokenHash)),
    redis.del(lastActiveDebounceKey(tokenHash)),
  ]);
}

export async function revokeSessionById(
  userId: string,
  sessionId: string,
): Promise<{ success: boolean; tokenHash?: string }> {
  const [session] = await db
    .select({
      id: userSessions.id,
      tokenHash: userSessions.tokenHash,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    return { success: false };
  }

  await revokeSessionByTokenHash(session.tokenHash);
  return { success: true, tokenHash: session.tokenHash };
}

export async function revokeAllSessionsForUser(
  userId: string,
  exceptTokenHash?: string | null,
): Promise<number> {
  const now = new Date();
  const activeSessions = await db
    .select({
      id: userSessions.id,
      tokenHash: userSessions.tokenHash,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ),
    );

  const targets = exceptTokenHash
    ? activeSessions.filter((session) => session.tokenHash !== exceptTokenHash)
    : activeSessions;

  if (targets.length === 0) {
    return 0;
  }

  await db
    .update(userSessions)
    .set({ revokedAt: now, isCurrent: false })
    .where(
      inArray(
        userSessions.id,
        targets.map((session) => session.id),
      ),
    );

  await Promise.all(
    targets.flatMap((session) => [
      redis.del(sessionRedisKey(session.tokenHash)),
      redis.del(lastActiveDebounceKey(session.tokenHash)),
    ]),
  );

  return targets.length;
}

export async function invalidateAllSessionsForUser(userId: string): Promise<number> {
  await deleteRefreshSession(userId);
  return revokeAllSessionsForUser(userId);
}

export async function listActiveSessionsForUser(
  userId: string,
  currentTokenHash: string | null,
): Promise<SessionListItem[]> {
  const now = new Date();
  await db
    .update(userSessions)
    .set({ isCurrent: false })
    .where(eq(userSessions.userId, userId));

  if (currentTokenHash) {
    await db
      .update(userSessions)
      .set({ isCurrent: true })
      .where(
        and(
          eq(userSessions.userId, userId),
          eq(userSessions.tokenHash, currentTokenHash),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
        ),
      );
  }

  const sessions = await db
    .select({
      id: userSessions.id,
      tokenHash: userSessions.tokenHash,
      deviceName: userSessions.deviceName,
      deviceType: userSessions.deviceType,
      browser: userSessions.browser,
      os: userSessions.os,
      ipAddress: userSessions.ipAddress,
      location: userSessions.location,
      lastActiveAt: userSessions.lastActiveAt,
      createdAt: userSessions.createdAt,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ),
    )
    .orderBy(desc(userSessions.lastActiveAt));

  return sessions.map((session) => ({
    ...session,
    isCurrent: currentTokenHash ? session.tokenHash === currentTokenHash : false,
  }));
}
