import type { Express } from 'express';

/** Max JSON/binary payload per WebSocket frame (signaling SDP can be large). */
export const WS_MAX_MESSAGE_BYTES = clampInt(
  process.env.WS_MAX_MESSAGE_BYTES,
  4096,
  2_000_000,
  524_288,
);

/** Postgres.js pool size — tune under load (e.g. PgBouncer + higher app concurrency). */
export function getDatabasePoolMax(): number {
  return clampInt(process.env.DATABASE_POOL_MAX, 1, 100, 10);
}

/**
 * Behind nginx/Cloudflare/load balancers, set TRUST_PROXY=1 so req.ip and rate limits use X-Forwarded-For.
 * Use TRUST_PROXY=2 if there are two proxy hops, etc.
 */
export function configureTrustProxy(app: Express): void {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw || raw === '0' || raw === 'false') return;
  if (raw === 'true' || raw === '1') {
    app.set('trust proxy', 1);
    return;
  }
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) {
    app.set('trust proxy', n);
  }
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
