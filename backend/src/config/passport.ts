import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { googleOAuthLogin } from '../services/auth';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName || email?.split('@')[0] || 'User';

        if (!email) {
          return done(new Error('No email from Google'), undefined);
        }

        const result = await googleOAuthLogin(profile.id, email, name);
        done(null, result);
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  )
);

export default passport;