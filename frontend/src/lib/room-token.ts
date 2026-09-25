/**
 * Room-token helpers for the client.
 *
 * The room token is a JWT the browser receives at join time. It is only *read*
 * here (the server is the verifier) so the client can schedule a renewal before
 * `exp` instead of discovering expiry when the server closes the socket.
 */

export interface RoomTokenClaims {
  userId: string;
  roomId: string;
  exp: number;
  waiting?: boolean;
}

/** Renew this long before expiry… */
export const REFRESH_LEAD_MS = 5 * 60 * 1000;
/** …but never sooner than this after connect, to avoid a tight loop. */
export const REFRESH_MIN_DELAY_MS = 30 * 1000;

function base64UrlDecode(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const withPadding = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=');
    return atob(withPadding);
  } catch {
    return null;
  }
}

/** Decode the token's claims. Returns null for anything malformed — never throws. */
export function decodeRoomToken(token: string): RoomTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const json = base64UrlDecode(parts[1] as string);
  if (!json) return null;
  try {
    const claims = JSON.parse(json) as Partial<RoomTokenClaims>;
    if (typeof claims.userId !== 'string') return null;
    if (typeof claims.roomId !== 'string') return null;
    if (typeof claims.exp !== 'number') return null;
    return {
      userId: claims.userId,
      roomId: claims.roomId,
      exp: claims.exp,
      ...(claims.waiting === true ? { waiting: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Milliseconds from `now` until the token should be renewed, or null if it
 * cannot be parsed. Already-expired or nearly-expired tokens return 0 so the
 * caller refreshes immediately rather than waiting.
 */
export function refreshDelayMs(
  token: string,
  now: number = Date.now(),
): number | null {
  const claims = decodeRoomToken(token);
  if (!claims) return null;

  const expiresAtMs = claims.exp * 1000;
  const target = expiresAtMs - REFRESH_LEAD_MS;
  if (target <= now) return 0;
  return Math.max(target - now, REFRESH_MIN_DELAY_MS);
}
