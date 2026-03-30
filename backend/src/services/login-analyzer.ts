import { createHash } from 'crypto';
import geoip from 'geoip-lite';
import { and, desc, eq, gt } from 'drizzle-orm';
import { redis } from '../config/redis.js';
import { db } from '../db/index.js';
import { loginEvents, userSessions } from '../db/schema.js';

export interface LoginContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
  country: string;
  city: string;
  browser: string;
  os: string;
  deviceType: string;
}

export interface SuspicionResult {
  isSuspicious: boolean;
  reasons: string[];
  riskScore: number;
  deviceFingerprint: string;
}

const LOGIN_COUNTRY_RISK = 40;
const NEW_DEVICE_RISK = 30;
const IMPOSSIBLE_TRAVEL_RISK = 60;
const LONG_ABSENCE_RISK = 20;
const UNUSUAL_HOUR_RISK = 15;
const TOR_EXIT_RISK = 35;

function deviceFingerprintFor(input: Pick<LoginContext, 'browser' | 'os' | 'deviceType'>): string {
  return createHash('sha256')
    .update(`${input.browser}|${input.os}|${input.deviceType}`)
    .digest('hex');
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getGeoCoordinates(ip: string): { lat: number; lon: number } | null {
  const match = geoip.lookup(ip);
  if (!match || !Array.isArray(match.ll) || match.ll.length !== 2) {
    return null;
  }
  const [lat, lon] = match.ll;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return null;
  }
  return { lat, lon };
}

function hasUnusualHour(hours: number[], currentHour: number): boolean {
  if (hours.length < 5) {
    return false;
  }
  const frequency = new Map<number, number>();
  for (const hour of hours) {
    frequency.set(hour, (frequency.get(hour) ?? 0) + 1);
  }
  const usualHours = Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(6, frequency.size))
    .map(([hour]) => hour);
  return !usualHours.includes(currentHour);
}

export async function analyzeLogin(context: LoginContext): Promise<SuspicionResult> {
  const reasons: string[] = [];
  let riskScore = 0;
  const deviceFingerprint = deviceFingerprintFor(context);

  const recentCountryEvents = await db
    .select({
      country: loginEvents.country,
    })
    .from(loginEvents)
    .where(eq(loginEvents.userId, context.userId))
    .orderBy(desc(loginEvents.createdAt))
    .limit(30);
  const seenCountry = recentCountryEvents.some(
    (entry) => (entry.country ?? '').toLowerCase() === context.country.toLowerCase(),
  );
  if (context.country && !seenCountry && recentCountryEvents.length > 0) {
    reasons.push('LOGIN_FROM_NEW_COUNTRY');
    riskScore += LOGIN_COUNTRY_RISK;
  }

  const priorSessions = await db
    .select({
      browser: userSessions.browser,
      os: userSessions.os,
      deviceType: userSessions.deviceType,
    })
    .from(userSessions)
    .where(eq(userSessions.userId, context.userId));
  const knownFingerprint = priorSessions.some((session) => {
    const sessionFp = deviceFingerprintFor({
      browser: session.browser ?? '',
      os: session.os ?? '',
      deviceType: session.deviceType ?? '',
    });
    return sessionFp === deviceFingerprint;
  });
  if (!knownFingerprint && priorSessions.length > 0) {
    reasons.push('NEW_DEVICE');
    riskScore += NEW_DEVICE_RISK;
  }

  const now = new Date();
  const recentThreshold = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const [recentEvent] = await db
    .select({
      ipAddress: loginEvents.ipAddress,
      createdAt: loginEvents.createdAt,
    })
    .from(loginEvents)
    .where(and(eq(loginEvents.userId, context.userId), gt(loginEvents.createdAt, recentThreshold)))
    .orderBy(desc(loginEvents.createdAt))
    .limit(1);

  if (recentEvent?.ipAddress && recentEvent.createdAt) {
    const previousCoords = getGeoCoordinates(recentEvent.ipAddress);
    const currentCoords = getGeoCoordinates(context.ipAddress);
    if (previousCoords && currentCoords) {
      const distanceKm = haversineKm(
        previousCoords.lat,
        previousCoords.lon,
        currentCoords.lat,
        currentCoords.lon,
      );
      const elapsedHours = Math.max(
        1 / 60,
        (now.getTime() - recentEvent.createdAt.getTime()) / (1000 * 60 * 60),
      );
      const requiredSpeed = distanceKm / elapsedHours;
      if (requiredSpeed > 900) {
        reasons.push('IMPOSSIBLE_TRAVEL');
        riskScore += IMPOSSIBLE_TRAVEL_RISK;
      }
    }
  }

  const [lastEvent] = await db
    .select({
      createdAt: loginEvents.createdAt,
    })
    .from(loginEvents)
    .where(eq(loginEvents.userId, context.userId))
    .orderBy(desc(loginEvents.createdAt))
    .limit(1);
  if (lastEvent?.createdAt) {
    const absentForMs = now.getTime() - lastEvent.createdAt.getTime();
    if (absentForMs > 30 * 24 * 60 * 60 * 1000) {
      reasons.push('LOGIN_AFTER_LONG_ABSENCE');
      riskScore += LONG_ABSENCE_RISK;
    }
  }

  const historicalHours = await db
    .select({
      createdAt: loginEvents.createdAt,
    })
    .from(loginEvents)
    .where(eq(loginEvents.userId, context.userId))
    .orderBy(desc(loginEvents.createdAt))
    .limit(20);
  const currentHourUtc = now.getUTCHours();
  if (
    hasUnusualHour(
      historicalHours
        .map((entry) => entry.createdAt?.getUTCHours())
        .filter((value): value is number => typeof value === 'number'),
      currentHourUtc,
    )
  ) {
    reasons.push('UNUSUAL_LOGIN_TIME');
    riskScore += UNUSUAL_HOUR_RISK;
  }

  const isTorExit = await redis.sismember('torexits', context.ipAddress);
  if (isTorExit) {
    reasons.push('TOR_EXIT_NODE');
    riskScore += TOR_EXIT_RISK;
  }

  riskScore = Math.min(100, riskScore);
  return {
    isSuspicious: riskScore >= 30,
    reasons,
    riskScore,
    deviceFingerprint,
  };
}
