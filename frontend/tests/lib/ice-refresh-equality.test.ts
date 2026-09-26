// The scheduled TURN refresh used to restart ICE on *every* peer connection
// every 4 minutes, unconditionally, and each restart spent one of the three
// attempts reserved for recovering a genuinely failed connection.
//
// With the documented default deployment (public STUN, no TURN) the fetched
// `iceServers` are byte-identical every time, so that storm bought nothing at
// all. These pin the comparison that stops it.
import { describe, it, expect } from 'vitest';
import { iceServersEqual } from '@/lib/rtc-manager';

const stun = [{ urls: 'stun:stun.l.google.com:19302' }];
const turn = (username: string, credential: string) => ({
  urls: 'turn:turn.example.com:3478',
  username,
  credential,
});

describe('iceServersEqual', () => {
  it('treats identical STUN-only config as unchanged', () => {
    // The common case: no TURN, so every refresh returns the same list.
    expect(iceServersEqual(stun, [{ urls: 'stun:stun.l.google.com:19302' }])).toBe(true);
  });

  it('detects a TURN credential rotating', () => {
    // Credentials are HMAC-signed with a 5-minute TTL, so they change on every
    // fetch. That *is* a real change and does need new candidates gathered.
    expect(iceServersEqual([turn('t=1', 'sig=1')], [turn('t=2', 'sig=2')])).toBe(false);
  });

  it('detects a change in urls, username or credential independently', () => {
    expect(iceServersEqual([turn('u1', 'c1')], [{ urls: 'turn:other.example.com:3478', username: 'u1', credential: 'c1' }])).toBe(false);
    expect(iceServersEqual([turn('u1', 'c1')], [turn('u2', 'c1')])).toBe(false);
    expect(iceServersEqual([turn('u1', 'c1')], [turn('u1', 'c2')])).toBe(false);
  });

  it('detects a server being added or removed', () => {
    expect(iceServersEqual(stun, [...stun, turn('u1', 'c1')])).toBe(false);
    expect(iceServersEqual([...stun, turn('u1', 'c1')], stun)).toBe(false);
  });

  it('is order-insensitive, since a reordered list is not a config change', () => {
    const a = [turn('u1', 'c1'), { urls: 'stun:stun.l.google.com:19302' }];
    const b = [{ urls: 'stun:stun.l.google.com:19302' }, turn('u1', 'c1')];
    expect(iceServersEqual(a, b)).toBe(true);
  });

  it('handles the degenerate shapes without throwing', () => {
    expect(iceServersEqual([], [])).toBe(true);
    expect(iceServersEqual(undefined, [])).toBe(true);
    expect(iceServersEqual([], undefined)).toBe(true);
    expect(iceServersEqual(undefined, undefined)).toBe(true);
    expect(iceServersEqual(stun, undefined)).toBe(false);
  });

  it('does not confuse a server present in one list with a different one', () => {
    expect(
      iceServersEqual([{ urls: 'stun:a.example.com' }], [{ urls: 'stun:b.example.com' }]),
    ).toBe(false);
  });
});
