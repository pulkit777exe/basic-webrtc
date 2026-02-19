import { Router, Request, Response } from 'express';
import { signup, login, verifyEmailWithOtp, refreshTokens } from '../services/auth.js';
import { createAndSendOtp, verifyOtp } from '../services/otp.js';
import { SignupPayload, LoginPayload, VerifyOtpPayload } from '../types/index.js';
import { checkOtpRateLimit } from '../config/redis.js';
import { logoutRevoke, authenticateToken } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }
    res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, emailVerified: user.emailVerified } });
  } catch (error) {
    console.error('[Auth Me Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload: SignupPayload = req.body;
    const result = await signup(payload);

    if (!result.success) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    const rateLimit = await checkOtpRateLimit(payload.email);
    if (!rateLimit.allowed) {
      res.status(429).set('Retry-After', String(rateLimit.resetIn)).json({
        error: 'Too many OTP requests. Please try again later.',
        retryAfter: rateLimit.resetIn,
      });
      return;
    }

    await createAndSendOtp(payload.email);

    res.status(201).json({
      message: 'User created. Please verify your email.',
      otpRemaining: rateLimit.remaining,
    });
  } catch (error) {
    console.error('[Signup Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }
    const rateLimit = await checkOtpRateLimit(email);
    if (!rateLimit.allowed) {
      res.status(429).set('Retry-After', String(rateLimit.resetIn)).json({
        error: 'Too many OTP requests. Please try again later.',
        retryAfter: rateLimit.resetIn,
      });
      return;
    }
    await createAndSendOtp(email);
    res.json({ message: 'OTP sent', remaining: rateLimit.remaining });
  } catch (error) {
    console.error('[Resend OTP Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload: VerifyOtpPayload = req.body;
    const isValid = await verifyOtp(payload.email, payload.code);
    if (!isValid) {
      res.status(400).json({ error: 'Invalid or expired OTP' });
      return;
    }
    await verifyEmailWithOtp(payload.email);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('[Verify OTP Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const payload: LoginPayload = req.body;
    const result = await login(payload);

    if (!result) {
      res.status(401).json({ error: 'Invalid credentials', code: 'UNAUTHORIZED' });
      return;
    }

    if (!result.user.emailVerified) {
      res.status(403).json({
        error: 'Email not verified',
        user: result.user,
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, cookieOptions);
    }
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token required', code: 'UNAUTHORIZED' });
      return;
    }
    const result = await refreshTokens(refreshToken);
    if (!result) {
      res.status(403).json({ error: 'Invalid or expired refresh token', code: 'FORBIDDEN' });
      return;
    }
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, cookieOptions);
    }
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) {
    console.error('[Refresh Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const token =
      req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : req.body?.accessToken;
    if (token) {
      await logoutRevoke(token);
    }
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Logout Error]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
