import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { setRefreshSession, getRefreshSession } from '../config/redis';
import { validatePassword } from '../utils/password';
import { validateName } from '../utils/bloomFilter';
import { AuthResponse, SignupPayload, LoginPayload } from '../types';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const SALT_ROUNDS = 10;

export async function signup(payload: SignupPayload): Promise<{ success: boolean; errors?: string[] }> {
  const { name, email, password } = payload;

  const nameValidation = validateName(name);
  if (!nameValidation.valid) {
    return { success: false, errors: nameValidation.errors };
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return { success: false, errors: passwordValidation.errors };
  }

  const existingEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail.length > 0) {
    return { success: false, errors: ['Email already registered'] };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  await db.insert(users).values({
    name: name.trim(),
    email,
    passwordHash,
    emailVerified: false,
  });

  return { success: true };
}

export async function login(payload: LoginPayload): Promise<AuthResponse | null> {
  const { email, password } = payload;

  const userResult = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (userResult.length === 0) {
    return null;
  }

  const user = userResult[0];

  if (!user.passwordHash) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  if (!user.emailVerified) {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: false,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });
  await setRefreshSession(user.id, hashToken(refreshToken));

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
    },
    accessToken,
    refreshToken,
  };
}

export async function refreshTokens(refreshToken: string): Promise<AuthResponse | null> {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return null;
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

export async function verifyEmailWithOtp(email: string): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.email, email))
    .returning();

  return result.length > 0;
}

export async function googleOAuthLogin(
  googleId: string,
  email: string,
  name: string,
): Promise<AuthResponse> {
  let user = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);

  if (user.length === 0) {
    const inserted = await db
      .insert(users)
      .values({
        name: name.trim() || email.split('@')[0] || 'User',
        email,
        googleId,
        emailVerified: true,
      })
      .returning();

    user = inserted;
  }

  const accessToken = generateAccessToken({ userId: user[0].id, email: user[0].email });
  const refreshToken = generateRefreshToken({ userId: user[0].id, email: user[0].email });
  await setRefreshSession(user[0].id, hashToken(refreshToken));

  return {
    user: {
      id: user[0].id,
      name: user[0].name,
      email: user[0].email,
      emailVerified: user[0].emailVerified,
      avatarUrl: user[0].avatarUrl,
    },
    accessToken,
    refreshToken,
  };
}
