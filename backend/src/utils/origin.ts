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

/**
 * Parse and validate the `ALLOWED_ORIGINS` env value.
 *
 * Only presence was checked at boot, so a production value of `" "` or `","`
 * started a server whose allowlist matched nothing — every browser request
 * (CORS) and every WebSocket upgrade was rejected with no clue why. Entries
 * must be absolute http(s) origins; blanks are dropped, and `problems` explains
 * what was wrong so startup can fail with an actionable message.
 */
export function parseAllowedOrigins(raw: string | undefined): {
  origins: string[];
  problems: string[];
} {
  const origins: string[] = [];
  const problems: string[] = [];

  for (const entry of (raw ?? '').split(',')) {
    const candidate = entry.trim();
    if (!candidate) continue;
    if (candidate === '*') {
      problems.push('"*" is not a valid origin (use explicit origins)');
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      problems.push(`"${candidate}" is not an absolute URL`);
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      problems.push(`"${candidate}" must use http or https`);
      continue;
    }
    // A path/query/fragment would never match an Origin header exactly.
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      problems.push(`"${candidate}" must be an origin without a path`);
      continue;
    }
    origins.push(parsed.origin);
  }

  return { origins, problems };
}
