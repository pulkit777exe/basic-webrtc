import jwt, { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { TokenPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const JWT_ROOM_SECRET = process.env.JWT_ROOM_SECRET || JWT_SECRET;
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';
const JWT_ROOM_EXPIRY = process.env.JWT_ROOM_EXPIRY || '2h';

export interface AccessTokenPayload extends TokenPayload {
  jti: string;
  exp: number;
}

export interface RoomTokenPayload {
  userId: string;
  roomId: string;
  exp: number;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(
    { ...payload, jti: randomUUID() },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRY } as SignOptions
  );
}

export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
  } as SignOptions);
}

export function generateRoomToken(userId: string, roomId: string): string {
  return jwt.sign(
    { userId, roomId },
    JWT_ROOM_SECRET,
    { expiresIn: JWT_ROOM_EXPIRY } as SignOptions
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function verifyRoomToken(token: string): RoomTokenPayload | null {
  try {
    return jwt.verify(token, JWT_ROOM_SECRET) as RoomTokenPayload;
  } catch {
    return null;
  }
}

export function decodeAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.decode(token) as AccessTokenPayload & { exp?: number } | null;
    if (!decoded || !decoded.exp) return null;
    return decoded as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function getRefreshTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
}
