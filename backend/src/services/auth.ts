import bcrypt from 'bcrypt';
import { db } from '../db';
import { users, refreshTokens } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generateAccessToken, generateRefreshToken, getRefreshTokenExpiry } from '../utils/jwt';
import { validatePassword } from '../utils/password';
import { validateUsername, mightExist, addUsername } from '../utils/bloomFilter';
import { AuthResponse, SignupPayload, LoginPayload } from '../types';

const SALT_ROUNDS = 10;

export async function signup(payload: SignupPayload): Promise<{ success: boolean; errors?: string[] }> {
  const { username, email, password } = payload;

  // Validate username
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return { success: false, errors: usernameValidation.errors };
  }

  // Check Bloom filter (fast check)
  if (mightExist(username)) {
    // Double-check in database (might be false positive)
    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return { success: false, errors: ['Username already taken'] };
    }
  }

  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return { success: false, errors: passwordValidation.errors };
  }

  // Check if email exists
  const existingEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingEmail.length > 0) {
    return { success: false, errors: ['Email already registered'] };
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Create user
  await db.insert(users).values({
    username,
    email,
    passwordHash,
    emailVerified: false,
  });

  // Add to Bloom filter
  addUsername(username);

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
    return null; // Google OAuth user
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  if (!user.emailVerified) {
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: false,
      },
    };
  }

  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

  // Store refresh token
  await db.insert(refreshTokens).values({
    userId: user.id,
    token: refreshToken,
    expiresAt: getRefreshTokenExpiry(),
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
    },
    accessToken,
  };
}

export async function verifyEmailWithOtp(email: string): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.email, email))
    .returning();

  return result.length > 0;
}

export async function googleOAuthLogin(
  googleId: string,
  email: string,
  username: string
): Promise<AuthResponse> {
  let user = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);

  if (user.length === 0) {
    // Create new user
    const inserted = await db
      .insert(users)
      .values({
        username,
        email,
        googleId,
        emailVerified: true,
      })
      .returning();

    user = inserted;
    addUsername(username);
  }

  const accessToken = generateAccessToken({ userId: user[0].id, email: user[0].email });
  const refreshToken = generateRefreshToken({ userId: user[0].id, email: user[0].email });

  await db.insert(refreshTokens).values({
    userId: user[0].id,
    token: refreshToken,
    expiresAt: getRefreshTokenExpiry(),
  });

  return {
    user: {
      id: user[0].id,
      username: user[0].username,
      email: user[0].email,
      emailVerified: user[0].emailVerified,
    },
    accessToken,
  };
}