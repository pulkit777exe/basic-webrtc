import { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

const EXEMPT_PATHS = new Set([
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/me',
  '/api/auth/logout',
]);

export async function requireVerifiedEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    return;
  }

  const [user] = await db
    .select({
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.emailVerified) {
    res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email to continue',
    });
    return;
  }

  next();
}
