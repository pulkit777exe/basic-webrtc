import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { deleteRefreshSession } from '../config/redis.js';
import {
  extractAccessToken,
  hashSessionToken,
  revokeSessionByTokenHash,
  touchSessionActivity,
  validateSessionToken,
} from '../services/session.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      authUser?: {
        userId: string;
        email: string;
      };
      authToken?: string;
      authTokenHash?: string;
    }
  }
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractAccessToken(req);

  if (!token) {
    res.status(401).json({ error: 'Access token required', code: 'UNAUTHORIZED' });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(403).json({ error: 'Invalid or expired token', code: 'FORBIDDEN' });
    return;
  }

  (async () => {
    const tokenHash = hashSessionToken(token);
    const isActive = await validateSessionToken(payload.userId, tokenHash);
    if (!isActive) {
      res.status(401).json({ error: 'SESSION_REVOKED', code: 'SESSION_REVOKED' });
      return;
    }

    await touchSessionActivity(tokenHash);
    req.user = { id: payload.userId, email: payload.email };
    req.authUser = { userId: payload.userId, email: payload.email };
    req.authToken = token;
    req.authTokenHash = tokenHash;
    next();
  })().catch(() => {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });
}

export async function logoutRevoke(accessToken: string): Promise<string | null> {
  const decoded = verifyAccessToken(accessToken);
  if (!decoded) {
    return null;
  }
  await revokeSessionByTokenHash(hashSessionToken(accessToken));
  await deleteRefreshSession(decoded.userId);
  return decoded.userId;
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next);
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractAccessToken(req);

  if (!token) {
    next();
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    next();
    return;
  }

  (async () => {
    const tokenHash = hashSessionToken(token);
    const isActive = await validateSessionToken(payload.userId, tokenHash);
    if (isActive) {
      await touchSessionActivity(tokenHash);
      req.user = { id: payload.userId, email: payload.email };
      req.authUser = { userId: payload.userId, email: payload.email };
      req.authToken = token;
      req.authTokenHash = tokenHash;
    }
    next();
  })().catch(() => next());
}
