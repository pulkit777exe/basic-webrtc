import { describe, it, expect } from 'vitest';
import { cookieOptions } from '../../src/utils/cookies';

describe('cookieOptions', () => {
  it('sets the refresh cookie httpOnly', () => {
    expect(cookieOptions.httpOnly).toBe(true);
  });

  it('uses lax same-site', () => {
    expect(cookieOptions.sameSite).toBe('lax');
  });

  it('expires after 7 days', () => {
    expect(cookieOptions.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is secure only in production (local dev must still work over http)', () => {
    expect(cookieOptions.secure).toBe(process.env.NODE_ENV === 'production');
  });
});
