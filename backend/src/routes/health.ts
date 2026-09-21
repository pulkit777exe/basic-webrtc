import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { isRedisConfigured, redis } from '../config/redis';
import { logger } from '../lib/logger';

export const healthRouter = Router();

/** Liveness: process is up (use for load balancer "ping"). */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Readiness: Postgres must be reachable; Redis is reported but only required
 * when configured. This keeps Render's free-tier health check green for the
 * liveness path while still surfacing dependency state for orchestrators.
 * Returns 503 only when Postgres is down.
 */
healthRouter.get('/health/ready', async (_req, res) => {
  const start = Date.now();
  const checks: Record<string, string> = {};
  let postgresOk = false;

  try {
    await db.execute(sql`SELECT 1`);
    postgresOk = true;
    checks.postgres = 'ok';
  } catch (err) {
    checks.postgres = 'error';
    logger.error('Readiness check failed', {
      error: err instanceof Error ? err.message : String(err),
      latency: Date.now() - start,
    });
  }

  if (!isRedisConfigured) {
    checks.redis = 'disabled';
  } else {
    try {
      const pong = await redis.ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'error';
    } catch (err) {
      checks.redis = 'error';
      logger.error('Readiness check failed', {
        error: err instanceof Error ? err.message : String(err),
        latency: Date.now() - start,
      });
    }
  }

  if (!postgresOk) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    });
    return;
  }

  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    checks,
    latency: { db: Date.now() - start },
  });
});


