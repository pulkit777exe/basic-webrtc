import { Router } from 'express';
import passport from '../config/passport';
import { createSessionForAccessToken } from '../services/session.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';
import { setRefreshSession } from '../config/redis.js';
import { queueEmail } from '../services/email.js';
import { hashToken, getFrontendBaseUrl } from '../utils/crypto.js';

type OAuthUser = {
  id: string;
  email: string;
  name: string;
};

const router = Router();

router.get('/google', (req, res, next) => {
  const state = typeof req.query?.state === 'string' ? req.query.state : undefined;
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    ...(state ? { state } : {}),
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate(
    'google',
    { session: false },
    async (
      err: unknown,
      user: OAuthUser | false,
      info?: {
        linkToken?: string;
        linkError?: string;
        linkedViaState?: boolean;
      },
    ) => {
      if (err) {
        console.error('[Google OAuth Callback Error]', err);
        res.redirect(`${getFrontendBaseUrl()}/auth/login?oauthError=oauth_failed`);
        return;
      }

      if (info?.linkToken) {
        res.redirect(
          `${getFrontendBaseUrl()}/auth/link-account?token=${encodeURIComponent(info.linkToken)}`,
        );
        return;
      }

      if (!user) {
        const errorCode = info?.linkError || 'oauth_failed';
        res.redirect(
          `${getFrontendBaseUrl()}/auth/login?oauthError=${encodeURIComponent(errorCode)}`,
        );
        return;
      }

      const accessToken = generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = generateRefreshToken({ userId: user.id, email: user.email });

      await setRefreshSession(user.id, hashToken(refreshToken));
      await createSessionForAccessToken(user.id, accessToken, req);

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      if (info?.linkedViaState) {
        try {
          await queueEmail({
            to: user.email,
            template: 'google_linked',
            data: {
              userName: user.name,
              googleEmail: user.email,
            },
          });
        } catch (emailError) {
          console.error('[Google Linked Email Error]', emailError);
        }
      }

      const redirectUrl = new URL(`${getFrontendBaseUrl()}/dashboard`);
      redirectUrl.searchParams.set('token', accessToken);
      if (info?.linkedViaState) {
        redirectUrl.searchParams.set('googleLinked', '1');
      }
      res.redirect(redirectUrl.toString());
    },
  )(req, res, next);
});

export default router;
