/**
 * Authorization policy for an inbound WebSocket message.
 *
 * The checks live here as a pure function so the *decisions* — which check
 * runs when, in what order, and which close code it produces — are testable
 * without Redis or Postgres. Callers gather the facts; this decides.
 *
 * Order matters and is part of the contract:
 *   1. token expiry (free, local) — fail before spending a round trip
 *   2. kicked (a Redis read, already paid on every message)
 *   3. heartbeat only: room exists, then account session
 *
 * The heartbeat-only checks are the expensive ones (a room-meta read and a
 * database query), so they run on the ~25s ping rather than per message. That
 * also means a client that stops pinging is only caught by the checks that do
 * run per message — which is why token expiry and kick are not gated on it.
 */

export type DenialReason = 'token_expired' | 'kicked' | 'room_gone' | 'session_revoked';

export interface Denial {
  reason: DenialReason;
  /** WebSocket close code. */
  code: number;
  /** Message for the `error` signal, or null when a typed signal is sent instead. */
  message: string | null;
  /** Typed signal to send before closing, when the client must distinguish. */
  signal: 'token_expired' | 'kicked' | null;
}

export interface AuthorizationFacts {
  /** Local HMAC + expiry check on the socket's room token. */
  tokenValid: boolean;
  kicked: boolean;
  /** Heartbeat only: the room still exists and has not ended. */
  roomExists?: boolean | null;
  /** Heartbeat only: the account still has a live (non-revoked) session. */
  hasSession?: boolean | null;
  /** True for the `ping` heartbeat, which is where the costly checks run. */
  isHeartbeat: boolean;
}

export function authorizeInbound(facts: AuthorizationFacts): Denial | null {
  if (!facts.tokenValid) {
    return { reason: 'token_expired', code: 4004, message: null, signal: 'token_expired' };
  }
  if (facts.kicked) {
    return { reason: 'kicked', code: 4003, message: null, signal: 'kicked' };
  }
  if (facts.isHeartbeat) {
    if (facts.roomExists === false) {
      return { reason: 'room_gone', code: 4002, message: 'Room not found or ended', signal: null };
    }
    // Only fail closed on an explicit `false`. A null means the check was not
    // run (or the lookup failed transiently) and must not end a live call.
    if (facts.hasSession === false) {
      return { reason: 'session_revoked', code: 4005, message: 'Session revoked', signal: null };
    }
  }
  return null;
}
