/** Shared cookie attributes for the refresh-token cookie. Reuse the same
 *  object for `clearCookie` — browsers only delete a cookie when the clear
 *  matches the original path/domain/secure/sameSite attributes. */
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
