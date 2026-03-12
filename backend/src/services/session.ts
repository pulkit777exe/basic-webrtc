import { createHash } from 'crypto';
import type { Request } from 'express';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';
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
  country: string | null;
  city: string | null;
  location: string | null;
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

export interface SessionCreationResult {
  sessionId: string;
  tokenHash: string;
  deviceInfo: ParsedDeviceInfo;
  ipAddress: string | null;
}

function sessionRedisKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

function sessionRestrictedRedisKey(tokenHash: string): string {
  return `session:restricted:${tokenHash}`;
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

function getRequestLocationFromHeaders(req: Request): string | null {
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

function mapDeviceType(deviceType?: string): ParsedDeviceInfo['deviceType'] {
  const normalized = (deviceType || '').toLowerCase();
  if (normalized === 'mobile') return 'mobile';
  if (normalized === 'tablet') return 'tablet';
  if (normalized === 'smarttv' || normalized === 'wearable' || normalized === 'embedded') {
    return 'unknown';
  }
  if (normalized === '') return 'desktop';
  return 'desktop';
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getClientIp(req: Request): string | null {
  return getForwardedIp(req) ?? sanitizeIp(req.ip);
}

export function parseUserAgent(userAgentRaw: string | undefined): ParsedDeviceInfo {
  const parsed = new UAParser(userAgentRaw ?? '').getResult();
  const browser = parsed.browser.name ?? null;
  const os = parsed.os.name ?? null;
  const deviceType = mapDeviceType(parsed.device.type);
  const deviceName = browser && os ? `${browser} on ${os}` : browser || os || null;

  return {
    deviceName,
    deviceType,
    browser,
    os,
    country: null,
    city: null,
    location: null,
  };
}

function enrichLocation(
  req: Request,
  ipAddress: string | null,
): Pick<ParsedDeviceInfo, 'country' | 'city' | 'location'> {
  const headerLocation = getRequestLocationFromHeaders(req);
  let country: string | null = null;
  let city: string | null = null;
  let location: string | null = headerLocation;

  if (ipAddress) {
    const geo = geoip.lookup(ipAddress);
    if (geo) {
      country = geo.country ?? null;
      city = geo.city ?? null;
      if (!location) {
        if (city && country) {
          location = `${city}, ${country}`;
        } else if (country) {
          location = country;
        }
      }
    }
  }

  if (location && !country) {
    const [first, second] = location.split(',').map((part) => part.trim());
    if (second) {
      city = city ?? first;
      country = second;
    } else {
      country = first;
    }
  }

  return { country, city, location };
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
  options?: { suspiciousVerifiedAt?: Date | null },
): Promise<SessionCreationResult> {
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + DEFAULT_SESSION_TTL_SECONDS * 1000);
  const parsedDevice = parseUserAgent(req.headers['user-agent']);
  const ipAddress = getClientIp(req);
  const locationInfo = enrichLocation(req, ipAddress);
  const deviceInfo: ParsedDeviceInfo = {
    ...parsedDevice,
    ...locationInfo,
  };
  const suspiciousVerifiedAt = options?.suspiciousVerifiedAt ?? new Date();

  const [session] = await db.insert(userSessions).values({
    userId,
    tokenHash,
    deviceName: deviceInfo.deviceName,
    deviceType: deviceInfo.deviceType,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    ipAddress,
    location: deviceInfo.location,
    expiresAt,
    lastActiveAt: new Date(),
    suspiciousVerifiedAt,
  }).returning({ id: userSessions.id });

  await redis.set(sessionRedisKey(tokenHash), userId, 'EX', DEFAULT_SESSION_TTL_SECONDS);
  if (suspiciousVerifiedAt) {
    await redis.del(sessionRestrictedRedisKey(tokenHash));
  } else {
    await redis.set(sessionRestrictedRedisKey(tokenHash), '1', 'EX', DEFAULT_SESSION_TTL_SECONDS);
  }

  return {
    sessionId: session.id,
    tokenHash,
    deviceInfo,
    ipAddress,
  };
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
    redis.del(sessionRestrictedRedisKey(tokenHash)),
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
      redis.del(sessionRestrictedRedisKey(session.tokenHash)),
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

export async function isSessionRestricted(tokenHash: string): Promise<boolean> {
  const cached = await redis.get(sessionRestrictedRedisKey(tokenHash));
  if (cached === '1') {
    return true;
  }

  const [session] = await db
    .select({
      suspiciousVerifiedAt: userSessions.suspiciousVerifiedAt,
      revokedAt: userSessions.revokedAt,
      expiresAt: userSessions.expiresAt,
    })
    .from(userSessions)
    .where(eq(userSessions.tokenHash, tokenHash))
    .limit(1);

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return false;
  }
  if (session.suspiciousVerifiedAt) {
    return false;
  }

  const ttl = ttlFromExpiry(session.expiresAt);
  await redis.set(sessionRestrictedRedisKey(tokenHash), '1', 'EX', ttl);
  return true;
}

export async function markSessionSuspiciousVerified(tokenHash: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ suspiciousVerifiedAt: new Date() })
    .where(eq(userSessions.tokenHash, tokenHash));
  await redis.del(sessionRestrictedRedisKey(tokenHash));
}
