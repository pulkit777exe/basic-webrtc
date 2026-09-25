import { describe, it, expect } from 'vitest';
import { decodeRoomToken, refreshDelayMs, REFRESH_LEAD_MS, REFRESH_MIN_DELAY_MS } from './room-token';

/** Build an unsigned JWT-shaped string; only the payload is ever read. */
function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const NOW = 1_700_000_000_000; // fixed clock for determinism

describe('decodeRoomToken', () => {
  it('reads userId, roomId, and exp', () => {
    const token = makeToken({ userId: 'u1', roomId: 'r1', exp: 1_700_000_000 });
    expect(decodeRoomToken(token)).toEqual({ userId: 'u1', roomId: 'r1', exp: 1_700_000_000 });
  });

  it('flags waiting tokens', () => {
    const token = makeToken({ userId: 'u1', roomId: 'r1', exp: 1, waiting: true });
    expect(decodeRoomToken(token)?.waiting).toBe(true);
  });

  it('returns null for malformed input instead of throwing', () => {
    expect(decodeRoomToken('')).toBeNull();
    expect(decodeRoomToken('not-a-jwt')).toBeNull();
    expect(decodeRoomToken('a.b')).toBeNull();
    expect(decodeRoomToken('a.!!!.c')).toBeNull();
  });

  it('returns null when required claims are missing or mistyped', () => {
    expect(decodeRoomToken(makeToken({ roomId: 'r1', exp: 1 }))).toBeNull();
    expect(decodeRoomToken(makeToken({ userId: 'u1', exp: 1 }))).toBeNull();
    expect(decodeRoomToken(makeToken({ userId: 'u1', roomId: 'r1' }))).toBeNull();
    expect(decodeRoomToken(makeToken({ userId: 1, roomId: 'r1', exp: 1 }))).toBeNull();
  });

  it('handles base64url payloads with - and _ characters', () => {
    // A payload whose base64 contains the URL-safe alphabet.
    const token = makeToken({ userId: 'a?~b', roomId: 'rÿ', exp: 42 });
    expect(decodeRoomToken(token)).toMatchObject({ userId: 'a?~b', exp: 42 });
  });
});

describe('refreshDelayMs', () => {
  it('schedules a refresh 5 minutes before expiry', () => {
    const expSeconds = (NOW + 60 * 60 * 1000) / 1000; // expires in 1h
    const delay = refreshDelayMs(makeToken({ userId: 'u', roomId: 'r', exp: expSeconds }), NOW);
    expect(delay).toBe(60 * 60 * 1000 - REFRESH_LEAD_MS);
  });

  it('refreshes immediately when already inside the 5-minute lead window', () => {
    // Expires in 1 minute: the refresh point has already passed.
    const expSeconds = (NOW + 60 * 1000) / 1000;
    const delay = refreshDelayMs(makeToken({ userId: 'u', roomId: 'r', exp: expSeconds }), NOW);
    expect(delay).toBe(0);
  });

  it('floors a near-immediate refresh at the minimum delay', () => {
    // Refresh point is 10s away: refreshing instantly would spin, so wait.
    const expSeconds = (NOW + REFRESH_LEAD_MS + 10_000) / 1000;
    const delay = refreshDelayMs(makeToken({ userId: 'u', roomId: 'r', exp: expSeconds }), NOW);
    expect(delay).toBe(REFRESH_MIN_DELAY_MS);
  });

  it('returns 0 for an already expired token so the caller refreshes now', () => {
    const expSeconds = (NOW - 1000) / 1000;
    expect(refreshDelayMs(makeToken({ userId: 'u', roomId: 'r', exp: expSeconds }), NOW)).toBe(0);
  });

  it('returns null when the token cannot be parsed', () => {
    expect(refreshDelayMs('garbage', NOW)).toBeNull();
  });
});
