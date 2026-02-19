import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, decodeAccessToken } from '../utils/jwt.js';
import { isBlocklisted, addToBlocklist, deleteRefreshSession } from '../config/redis.js';

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
  const token =
    req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : req.cookies?.accessToken ?? req.body?.accessToken;

  if (!token) {
    res.status(401).json({ error: 'Access token required', code: 'UNAUTHORIZED' });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(403).json({ error: 'Invalid or expired token', code: 'FORBIDDEN' });
    return;
  }

  isBlocklisted(payload.jti)
    .then((blocked) => {
      if (blocked) {
        res.status(403).json({ error: 'Token revoked', code: 'FORBIDDEN' });
        return;
      }
      req.user = { id: payload.userId, email: payload.email };
      req.authUser = { userId: payload.userId, email: payload.email };
      next();
    })
    .catch(() => {
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    });
}

export async function logoutRevoke(accessToken: string): Promise<string | null> {
  const decoded = decodeAccessToken(accessToken);
  if (!decoded) return null;
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(0, decoded.exp - now);
  await addToBlocklist(decoded.jti, ttl);
  await deleteRefreshSession(decoded.userId);
  return decoded.userId;
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next);
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const token =
    req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : req.cookies?.accessToken ?? req.body?.accessToken;

  if (!token) {
    next();
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    next();
    return;
  }

  isBlocklisted(payload.jti)
    .then((blocked) => {
      if (!blocked) {
        req.user = { id: payload.userId, email: payload.email };
        req.authUser = { userId: payload.userId, email: payload.email };
      }
      next();
    })
    .catch(() => next());
}