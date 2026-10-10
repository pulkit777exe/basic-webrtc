// The close code a client gets for a given state, and the order the checks run
// in, are contract — a client reconnects differently for 4003 than for 4004, and
// a transient lookup failure must never end a live call.
import { describe, it, expect } from 'vitest';
import { authorizeInbound, type AuthorizationFacts } from '../../src/lib/ws-authz';

const ok: AuthorizationFacts = {
  tokenValid: true,
  kicked: false,
  isHeartbeat: false,
};

const heartbeat: AuthorizationFacts = { ...ok, isHeartbeat: true, roomExists: true, hasSession: true };

describe('authorizeInbound: allowed', () => {
  it('allows a normal message from a healthy socket', () => {
    expect(authorizeInbound(ok)).toBeNull();
  });

  it('allows a heartbeat when everything checks out', () => {
    expect(authorizeInbound(heartbeat)).toBeNull();
  });

  it('ignores heartbeat-only facts on a non-heartbeat message', () => {
    // roomExists/hasSession are not gathered for these, so they must be absent
    // rather than inferred.
    expect(authorizeInbound({ ...ok, roomExists: false, hasSession: false })).toBeNull();
  });
});

describe('authorizeInbound: denials', () => {
  it('rejects an expired/invalid token first, before spending a round trip', () => {
    expect(
      authorizeInbound({ ...heartbeat, tokenValid: false, kicked: true, hasSession: false }),
    ).toEqual({ reason: 'token_expired', code: 4004, message: null, signal: 'token_expired' });
  });

  it('rejects a kicked user next, and sends the typed signal', () => {
    expect(authorizeInbound({ ...heartbeat, kicked: true })).toEqual({
      reason: 'kicked',
      code: 4003,
      message: null,
      signal: 'kicked',
    });
  });

  it('rejects a heartbeat for a room that has ended', () => {
    expect(authorizeInbound({ ...heartbeat, roomExists: false })).toEqual({
      reason: 'room_gone',
      code: 4002,
      message: 'Room not found or ended',
      signal: null,
    });
  });

  it('rejects a heartbeat when the account has no live session', () => {
    expect(authorizeInbound({ ...heartbeat, hasSession: false })).toEqual({
      reason: 'session_revoked',
      code: 4005,
      message: 'Session revoked',
      signal: null,
    });
  });

  it('prefers room_gone over session_revoked when both fail', () => {
    expect(authorizeInbound({ ...heartbeat, roomExists: false, hasSession: false })).toMatchObject({
      reason: 'room_gone',
      code: 4002,
    });
  });

  it('gives token expiry precedence over being kicked', () => {
    // A stale token is the more actionable reason for the client.
    expect(authorizeInbound({ ...ok, tokenValid: false, kicked: true })).toMatchObject({
      reason: 'token_expired',
    });
  });
});

describe('authorizeInbound: fail-open on unknown', () => {
  it('does not close a live call when a lookup was skipped or failed', () => {
    // null means "not run" — a transient Redis/DB error must not end a call.
    expect(authorizeInbound({ ...ok, isHeartbeat: true, roomExists: null, hasSession: null })).toBeNull();
    expect(authorizeInbound({ ...ok, isHeartbeat: true, roomExists: true, hasSession: null })).toBeNull();
    expect(authorizeInbound({ ...ok, isHeartbeat: true, roomExists: null, hasSession: true })).toBeNull();
  });

  it('only fails on an explicit false', () => {
    expect(authorizeInbound({ ...ok, isHeartbeat: true, hasSession: false })).not.toBeNull();
  });
});
