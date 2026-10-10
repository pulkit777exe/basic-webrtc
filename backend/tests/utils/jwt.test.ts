import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';

// Secrets must exist before the module is evaluated (it reads env at load),
// so set fallbacks first and import dynamically.
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
const jwtUtils = await import('../../src/utils/jwt');

describe('room tokens', () => {
  it('round-trips userId and roomId', () => {
    const token = jwtUtils.generateRoomToken('user-1', 'room-42');
    expect(jwtUtils.verifyRoomToken(token)).toMatchObject({
      userId: 'user-1',
      roomId: 'room-42',
    });
  });

  it('marks waiting tokens', () => {
    const token = jwtUtils.generateWaitingToken('user-2', 'room-7');
    expect(jwtUtils.verifyRoomToken(token)).toMatchObject({
      userId: 'user-2',
      roomId: 'room-7',
      waiting: true,
    });
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign({ userId: 'u', roomId: 'r' }, 'wrong-secret');
    expect(jwtUtils.verifyRoomToken(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { userId: 'u', roomId: 'r' },
      process.env.JWT_SECRET as string,
      { expiresIn: '-10s' },
    );
    expect(jwtUtils.verifyRoomToken(expired)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(jwtUtils.verifyRoomToken('not-a-jwt')).toBeNull();
    expect(jwtUtils.verifyRoomToken('')).toBeNull();
  });
});

describe('two-factor pending tokens', () => {
  it('round-trips a proper 2fa_pending token', () => {
    const token = jwtUtils.generateTwoFactorPendingToken({
      userId: 'u1',
      email: 'a@b.c',
    });
    expect(jwtUtils.verifyTwoFactorPendingToken(token)).toMatchObject({
      userId: 'u1',
      email: 'a@b.c',
      type: '2fa_pending',
    });
  });

  it('rejects a valid token missing the 2fa_pending type claim', () => {
    const wrongType = jwt.sign(
      { userId: 'u1', email: 'a@b.c' },
      process.env.JWT_SECRET as string,
      { expiresIn: '5m' },
    );
    expect(jwtUtils.verifyTwoFactorPendingToken(wrongType)).toBeNull();
  });
});
