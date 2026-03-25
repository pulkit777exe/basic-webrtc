import { randomBytes } from 'crypto';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { redis } from './redis';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      passReqToCallback: true,
    },
    async (req, _accessToken, _refreshToken, profile, done) => {
      try {
        const googleEmailRaw = profile.emails?.[0]?.value;
        const googleEmail = googleEmailRaw?.trim().toLowerCase();
        const googleId = profile.id;
        const googleName = (profile.displayName || googleEmail?.split('@')[0] || 'User').trim();
        const googleAvatar = profile.photos?.[0]?.value ?? null;

        if (!googleEmail) {
          return done(new Error('No email from Google'), undefined);
        }

        const rawState = typeof req.query?.state === 'string' ? req.query.state : '';
        let linkUserId: string | null = null;
        if (rawState.startsWith('link:')) {
          const stateToken = rawState.slice(5);
          const stateKey = `oauth:link-state:${stateToken}`;
          const stateUserId = await redis.get(stateKey);
          if (!stateUserId) {
            return done(null, false, { linkError: 'INVALID_OR_EXPIRED_LINK_STATE' });
          }
          linkUserId = stateUserId;
          await redis.del(stateKey);
        }

        if (linkUserId) {
          const [targetUser] = await db
            .select({
              id: users.id,
              email: users.email,
              name: users.name,
              avatarUrl: users.avatarUrl,
              googleId: users.googleId,
              deletedAt: users.deletedAt,
            })
            .from(users)
            .where(eq(users.id, linkUserId))
            .limit(1);

          if (!targetUser || targetUser.deletedAt) {
            return done(null, false, { linkError: 'TARGET_ACCOUNT_NOT_FOUND' });
          }

          const [googleAlreadyLinked] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.googleId, googleId))
            .limit(1);

          if (googleAlreadyLinked && googleAlreadyLinked.id !== targetUser.id) {
            return done(null, false, { linkError: 'GOOGLE_ACCOUNT_ALREADY_LINKED' });
          }

          await db
            .update(users)
            .set({
              googleId,
              googleLinkedAt: new Date(),
              googleEmail,
              avatarUrl: targetUser.avatarUrl ?? googleAvatar,
            })
            .where(eq(users.id, targetUser.id));

          const [linkedUser] = await db.select().from(users).where(eq(users.id, targetUser.id)).limit(1);
          return done(null, linkedUser, { linkedViaState: true });
        }

        const [existingGoogleUser] = await db
          .select()
          .from(users)
          .where(eq(users.googleId, googleId))
          .limit(1);

        if (existingGoogleUser) {
          if (existingGoogleUser.deletedAt) {
            return done(null, false, { linkError: 'ACCOUNT_SCHEDULED_FOR_DELETION' });
          }
          return done(null, existingGoogleUser);
        }

        const [existingEmailUser] = await db
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = ${googleEmail}`)
          .limit(1);

        if (existingEmailUser) {
          if (existingEmailUser.deletedAt) {
            return done(null, false, { linkError: 'ACCOUNT_SCHEDULED_FOR_DELETION' });
          }

          if (!existingEmailUser.googleId) {
            const linkToken = randomBytes(16).toString('hex');
            await redis.set(
              `oauth:pending:${linkToken}`,
              JSON.stringify({
                googleId,
                googleEmail,
                name: googleName,
                avatar: googleAvatar,
                existingUserId: existingEmailUser.id,
              }),
              'EX',
              600,
            );
            return done(null, false, { linkToken });
          }

          return done(null, false, { linkError: 'EMAIL_ALREADY_LINKED_TO_ANOTHER_GOOGLE_ACCOUNT' });
        }

        const [newUser] = await db
          .insert(users)
          .values({
            email: googleEmail,
            name: googleName,
            avatarUrl: googleAvatar,
            googleId,
            googleLinkedAt: new Date(),
            googleEmail,
            emailVerified: true,
          })
          .returning();

        return done(null, newUser);
      } catch (error) {
        return done(error as Error, undefined);
      }
    },
  ),
);

export default passport;
