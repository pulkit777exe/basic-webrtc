/**
 * Origin allowlist check for WebSocket upgrades (CSWSH hardening).
 *
 * Browsers always send an `Origin` header when opening a WebSocket; a page on
 * an attacker-controlled origin could otherwise connect with a token leaked
 * via URL history or referrers. Non-browser clients (curl, server code) omit
 * the header — those are still required to present a valid room token, so a
 * missing Origin is allowed. The comparison is exact, matching the behavior
 * of the REST `cors` middleware (same ALLOWED_ORIGINS list).
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined) return true;
  const normalized = origin.trim();
  if (normalized === '') return true;
  return allowed.some((entry) => entry.trim() === normalized);
}
