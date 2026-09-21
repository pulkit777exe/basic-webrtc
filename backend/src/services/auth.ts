import { hashToken } from '../utils/crypto';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { setRefreshSession, getRefreshSession, getUserSessionInvalidBefore } from '../config/redis';
import type { AuthResponse } from '../types';

export async function refreshTokens(refreshToken: string): Promise<AuthResponse | null> {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return null;
  const invalidBefore = await getUserSessionInvalidBefore(payload.userId);
  const tokenIssuedAt = payload.iat ?? 0;
  if (invalidBefore !== null && tokenIssuedAt < invalidBefore) {
    return null;
  }
  const storedHash = await getRefreshSession(payload.userId);
  if (!storedHash || storedHash !== hashToken(refreshToken)) return null;
  const userResult = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (userResult.length === 0) return null;
  const user = userResult[0];
  const newAccess = generateAccessToken({ userId: user.id, email: user.email });
  const newRefresh = generateRefreshToken({ userId: user.id, email: user.email });
  await setRefreshSession(user.id, hashToken(newRefresh));
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
    },
    accessToken: newAccess,
    refreshToken: newRefresh,
  };
}
