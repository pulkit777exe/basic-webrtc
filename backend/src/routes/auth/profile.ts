import bcrypt from 'bcrypt';
import { promises as fs } from 'fs';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';
import { Router, Request, Response } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createAndSendOtp, verifyOtp } from '../../services/otp.js';
import { redis } from '../../config/redis.js';
import { authenticateToken, requireUser } from '../../middleware/auth.js';
import { db } from '../../db/index.js';
import { backupCodes, users } from '../../db/schema.js';
import { queueEmail } from '../../services/email.js';
import { validatePassword } from '../../utils/password.js';
import { revokeAllSessionsForUser } from '../../services/session.js';
import { AVATAR_UPLOAD_DIR, normalizeEmail, sanitizeProfileName, isLocalAvatarPath, avatarUpload, isValidEmailFormat } from './shared.js';

const router = Router();

router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = requireUser(req, res);
    if (!authUser) return;
    const userId = authUser.id;
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
        googleId: users.googleId,
        googleLinkedAt: users.googleLinkedAt,
        googleEmail: users.googleEmail,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorEnabledAt: users.twoFactorEnabledAt,
        recoveryEmail: users.recoveryEmail,
        recoveryEmailVerified: users.recoveryEmailVerified,
        backupCodesGeneratedAt: users.backupCodesGeneratedAt,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }
    const [remainingCodesResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backupCodes)
      .where(and(eq(backupCodes.userId, userId), isNull(backupCodes.usedAt)));
    const pendingEmail = await redis.get(`email:pending:${userId}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        googleLinked: Boolean(user.googleId),
        googleLinkedAt: user.googleLinkedAt,
        googleEmail: user.googleEmail,
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorEnabledAt: user.twoFactorEnabledAt,
        recoveryEmail: user.recoveryEmail,
        recoveryEmailVerified: user.recoveryEmailVerified,
        backupCodesGeneratedAt: user.backupCodesGeneratedAt,
        backupCodesRemaining: Number(remainingCodesResult?.count ?? 0),
        hasPassword: Boolean(user.passwordHash),
        pendingEmail,
        restrictedSession: req.restrictedSession === true,
      },
    });
  } catch (error) {
    console.error('[Auth Me Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/profile', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = requireUser(req, res);
    if (!authUser) return;
    const userId = authUser.id;
    const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
    const name = sanitizeProfileName(rawName);

    if (name.length < 2 || name.length > 100) {
      res.status(400).json({ error: 'INVALID_NAME' });
      return;
    }

    const [updatedUser] = await db
      .update(users)
      .set({ name })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
      });

    if (!updatedUser) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    res.status(200).json({ user: updatedUser });
  } catch (error) {
    console.error('[Update Profile Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profile/avatar', authenticateToken, (req: Request, res: Response): void => {
  avatarUpload.single('avatar')(req, res, async (uploadError: unknown) => {
    try {
      if (uploadError) {
        if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: 'FILE_TOO_LARGE' });
          return;
        }
        const message = uploadError instanceof Error ? uploadError.message : 'INVALID_FILE';
        res.status(400).json({ error: message });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'AVATAR_FILE_REQUIRED' });
        return;
      }

      const metadata = await sharp(file.buffer).metadata();
      const allowedFormats = new Set(['jpeg', 'png', 'webp']);
      if (!metadata.format || !allowedFormats.has(metadata.format)) {
        res.status(400).json({ error: 'INVALID_IMAGE_CONTENT' });
        return;
      }

      const processedBuffer = await sharp(file.buffer)
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .webp({ quality: 85 })
        .toBuffer();

      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const [user] = await db
        .select({
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      await fs.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
      const fileName = `avatar-${userId}-${Date.now()}.webp`;
      const filePath = path.join(AVATAR_UPLOAD_DIR, fileName);
      await fs.writeFile(filePath, processedBuffer);
      const avatarUrl = `/uploads/avatars/${fileName}`;

      if (isLocalAvatarPath(user?.avatarUrl)) {
        const previousPath = path.resolve(user.avatarUrl.replace(/^\//, ''));
        if (previousPath !== filePath) {
          await fs.unlink(previousPath).catch(() => undefined);
        }
      }

      await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));
      res.status(200).json({ avatarUrl });
    } catch (error) {
      console.error('[Upload Avatar Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

router.delete(
  '/profile/avatar',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const [user] = await db
        .select({
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (isLocalAvatarPath(user?.avatarUrl)) {
        const avatarPath = path.resolve(user.avatarUrl.replace(/^\//, ''));
        await fs.unlink(avatarPath).catch(() => undefined);
      }

      await db.update(users).set({ avatarUrl: null }).where(eq(users.id, userId));
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Delete Avatar Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.patch(
  '/profile/password',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const currentPassword =
        typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'CURRENT_AND_NEW_PASSWORD_REQUIRED' });
        return;
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user.passwordHash) {
        res.status(400).json({ error: 'PASSWORD_AUTH_NOT_AVAILABLE' });
        return;
      }

      const validCurrentPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!validCurrentPassword) {
        res.status(401).json({ error: 'INVALID_CURRENT_PASSWORD' });
        return;
      }

      if (currentPassword === newPassword) {
        res.status(400).json({ error: 'NEW_PASSWORD_MUST_BE_DIFFERENT' });
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
      await revokeAllSessionsForUser(userId, req.authTokenHash ?? null);

      try {
        await queueEmail({
          to: user.email,
          template: 'profile_password_changed',
          data: {
            userName: user.name,
          },
        });
      } catch (emailError) {
        console.error('[Profile Password Changed Email Error]', emailError);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Change Password Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.patch(
  '/profile/email',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const newEmail =
        typeof req.body?.newEmail === 'string' ? normalizeEmail(req.body.newEmail) : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!newEmail || !password || !isValidEmailFormat(newEmail)) {
        res.status(400).json({ error: 'INVALID_INPUT' });
        return;
      }

      const [user] = await db
        .select({
          email: users.email,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user.passwordHash) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        res.status(401).json({ error: 'INVALID_PASSWORD' });
        return;
      }

      if (normalizeEmail(user.email) === newEmail) {
        res.status(400).json({ error: 'EMAIL_UNCHANGED' });
        return;
      }

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${newEmail}`)
        .limit(1);
      if (existing) {
        res.status(409).json({ error: 'EMAIL_EXISTS' });
        return;
      }

      await db.update(users).set({ emailVerified: false }).where(eq(users.id, userId));
      await redis.set(`email:pending:${userId}`, newEmail, { ex: 3600 });
      await createAndSendOtp(newEmail);

      res.status(200).json({ message: 'Verify your new email to confirm the change' });
    } catch (error) {
      console.error('[Change Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.get(
  '/profile/email/pending',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const pendingEmail = await redis.get(`email:pending:${authUser.id}`);
      res.status(200).json({ pendingEmail });
    } catch (error) {
      console.error('[Pending Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.post(
  '/profile/email/verify',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = requireUser(req, res);
      if (!authUser) return;
      const userId = authUser.id;
      const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
        return;
      }

      const pendingEmail = await redis.get(`email:pending:${userId}`);
      if (!pendingEmail) {
        res.status(400).json({ error: 'NO_PENDING_EMAIL_CHANGE' });
        return;
      }

      const verified = await verifyOtp(String(pendingEmail), otp);
      if (!verified) {
        res.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' });
        return;
      }

      await db
        .update(users)
        .set({
          email: String(pendingEmail),
          emailVerified: true,
        })
        .where(eq(users.id, userId));
      await redis.del(`email:pending:${userId}`);

      res.status(200).json({ success: true, email: pendingEmail });
    } catch (error) {
      console.error('[Verify Changed Email Error]', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);


export default router;
