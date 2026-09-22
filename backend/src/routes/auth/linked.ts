import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { redis } from '../../config/redis.js';
import { authenticateToken } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { validatePassword } from '../../utils/password.js';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt.js';
import { OAUTH_LINK_STATE_WINDOW_SECONDS, attachAuthSession } from './shared.js';

const router = Router();

router.get(
  '/link-google',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const stateToken = randomBytes(16).toString('hex');
      await redis.set(`oauth:link-state:${stateToken}`, req.user!.id, {
        ex: OAUTH_LINK_STATE_WINDOW_SECONDS,
      });
      res.redirect(`/api/oauth/google?state=${encodeURIComponent(`link:${stateToken}`)}`);
    } catch (error) {
      console.error('[Initiate Google Link Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get('/link-google/pending', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'LINK_TOKEN_REQUIRED' });
      return;
    }

    const payloadRaw = await redis.get(`oauth:pending:${token}`);
    if (!payloadRaw) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }

    const payload = JSON.parse(String(payloadRaw)) as {
      googleEmail: string;
      name: string;
      avatar?: string | null;
      existingUserId: string;
    };

    const [existingUser] = await db
      .select({
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, payload.existingUserId))
      .limit(1);
    if (!existingUser) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }

    res.status(200).json({
      google: {
        email: payload.googleEmail,
        name: payload.name,
        avatarUrl: payload.avatar || null,
      },
      existing: existingUser,
    });
  } catch (error) {
    console.error('[Get Pending Google Link Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/link-google/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const linkToken = typeof req.body?.linkToken === 'string' ? req.body.linkToken.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!linkToken || !password) {
      res.status(400).json({ error: 'LINK_TOKEN_AND_PASSWORD_REQUIRED' });
      return;
    }

    const payloadRaw = await redis.get(`oauth:pending:${linkToken}`);
    if (!payloadRaw) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }

    const payload = JSON.parse(String(payloadRaw)) as {
      googleId: string;
      googleEmail: string;
      name: string;
      avatar?: string | null;
      existingUserId: string;
    };

    const [existingUser] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        passwordHash: users.passwordHash,
        emailVerified: users.emailVerified,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, payload.existingUserId))
      .limit(1);
    if (!existingUser || existingUser.deletedAt) {
      res.status(400).json({ error: 'INVALID_OR_EXPIRED_LINK_TOKEN' });
      return;
    }
    if (!existingUser.passwordHash) {
      res.status(400).json({ error: 'PASSWORD_REQUIRED_FOR_LINKING' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, existingUser.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    await db
      .update(users)
      .set({
        googleId: payload.googleId,
        googleLinkedAt: new Date(),
        googleEmail: payload.googleEmail,
        avatarUrl: existingUser.avatarUrl ?? payload.avatar ?? null,
      })
      .where(eq(users.id, existingUser.id));
    await redis.del(`oauth:pending:${linkToken}`);

    const accessToken = generateAccessToken({
      userId: existingUser.id,
      email: existingUser.email,
    });
    const refreshToken = generateRefreshToken({
      userId: existingUser.id,
      email: existingUser.email,
    });
    await attachAuthSession(req, res, existingUser.id, accessToken, refreshToken);

    try {
      await queueEmail({
        to: existingUser.email,
        template: 'google_linked',
        data: {
          userName: existingUser.name,
          googleEmail: payload.googleEmail,
        },
      });
    } catch (emailError) {
      console.error('[Google Linked Email Error]', emailError);
    }

    res.status(200).json({
      user: {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        emailVerified: existingUser.emailVerified,
        avatarUrl: existingUser.avatarUrl ?? payload.avatar ?? null,
      },
      accessToken,
      message: 'Google account linked successfully',
    });
  } catch (error) {
    console.error('[Confirm Google Link Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete(
  '/unlink-google',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password) {
        res.status(400).json({ error: 'PASSWORD_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
          googleId: users.googleId,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }
      if (!user.passwordHash) {
        res.status(400).json({
          error: 'NO_PASSWORD_SET',
          message: 'Set a password before unlinking Google',
        });
        return;
      }
      if (!user.googleId) {
        res.status(400).json({ error: 'GOOGLE_NOT_LINKED' });
        return;
      }

      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      await db
        .update(users)
        .set({
          googleId: null,
          googleLinkedAt: null,
          googleEmail: null,
        })
        .where(eq(users.id, userId));

      try {
        await queueEmail({
          to: user.email,
          template: 'google_unlinked',
          data: {
            userName: user.name,
          },
        });
      } catch (emailError) {
        console.error('[Google Unlinked Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Unlink Google Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/set-password',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (!newPassword) {
        res.status(400).json({ error: 'PASSWORD_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }
      if (user.passwordHash) {
        res.status(400).json({ error: 'PASSWORD_ALREADY_SET' });
        return;
      }

      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.valid) {
        res.status(400).json({
          error: 'WEAK_PASSWORD',
          requirements: passwordValidation.errors,
        });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

      try {
        await queueEmail({
          to: user.email,
          template: 'password_added',
          data: {
            userName: user.name,
          },
        });
      } catch (emailError) {
        console.error('[Password Added Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Set Password Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);


export default router;
