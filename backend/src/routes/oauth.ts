import { Router } from 'express';
import passport from '../config/passport';
import { createSessionForAccessToken } from '../services/session.js';

const router = Router();

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  async (req, res) => {
    const user = req.user as
      | {
          user?: { id: string };
          accessToken?: string;
          refreshToken?: string;
        }
      | undefined;
    if (!user?.accessToken || !user.user?.id) {
      res.status(401).json({ error: 'OAuth authentication failed', code: 'UNAUTHORIZED' });
      return;
    }

    await createSessionForAccessToken(user.user.id, user.accessToken, req);

    if (user.refreshToken) {
      res.cookie('refreshToken', user.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    res.redirect(`http://localhost:3000/dashboard?token=${encodeURIComponent(user.accessToken)}`);
  }
);

export default router;
