// A kicked client used to be told to check its network.
//
// Every close except 4004 fell through to the reconnect loop, so 4002 (room
// gone), 4003 (kicked) and 4005 (session revoked) each burned all 10 attempts
// against a condition that can never clear, and finished on a "check your
// network or WebSocket URL" toast. These pin the classification that decides
// which closes are worth retrying.
import { describe, it, expect } from 'vitest';
import { classifyClose, MAX_RECONNECT } from '@/lib/connection';

describe('classifyClose', () => {
  it('retries transport failures, which is what backoff is for', () => {
    // 1006 abnormal closure is the classic dropped-connection case.
    expect(classifyClose(1006).kind).toBe('retry');
    expect(classifyClose(1011).kind).toBe('retry');
    // A server restart is transient even though the close is deliberate.
    expect(classifyClose(1001).kind).toBe('retry');
  });

  it('retries an unremarkable normal closure, since the server may just have cycled', () => {
    // The three connect-time rejections used to close with a bare close(), which
    // is 1000. Treating 1000 as terminal would strand a client whose socket was
    // recycled, so it stays retryable.
    expect(classifyClose(1000).kind).toBe('retry');
  });

  it('recovers the token on 4004 rather than replaying the rejected one', () => {
    // The existing special case: retrying the same expired token just bounces.
    expect(classifyClose(4004).kind).toBe('recover-token');
  });

  it('treats a kick as terminal, with a reason that is not about the network', () => {
    const outcome = classifyClose(4003);
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    // The user was removed from the room. Telling them to check their network
    // is the bug this classification exists to prevent.
    expect(outcome.reason).toMatch(/removed/i);
    expect(outcome.reason).not.toMatch(/network/i);
  });

  it('treats an ended room as terminal', () => {
    const outcome = classifyClose(4002);
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    expect(outcome.reason).toMatch(/ended|not found|no longer/i);
  });

  it('treats a revoked session as terminal, and points at signing in again', () => {
    const outcome = classifyClose(4005);
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    expect(outcome.reason).toMatch(/session|sign in/i);
  });

  it('treats bad authentication as terminal', () => {
    expect(classifyClose(4001).kind).toBe('terminal');
  });

  it('treats a full room as terminal, so it does not hammer a room that cannot admit', () => {
    const outcome = classifyClose(4009);
    expect(outcome.kind).toBe('terminal');
    if (outcome.kind !== 'terminal') throw new Error('unreachable');
    expect(outcome.reason).toMatch(/full/i);
  });

  it('reports no retry for a terminal close, whatever the attempt count', () => {
    // The failure mode being fixed: reconnectAttempts was incremented and the
    // loop ran to MAX_RECONNECT regardless of why the socket closed.
    for (const code of [4001, 4002, 4003, 4005, 4009]) {
      expect(classifyClose(code).kind, `code ${code}`).not.toBe('retry');
    }
    expect(MAX_RECONNECT).toBeGreaterThan(0);
  });
});
