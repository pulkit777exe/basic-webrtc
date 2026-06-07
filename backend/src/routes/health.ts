import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { redis } from '../config/redis';
import { logger } from '../lib/logger';

export const healthRouter = Router();

/** Liveness: process is up (use for load balancer "ping"). */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Readiness: Redis + Postgres reachable (use for orchestrator / rolling deploys).
 * Returns 503 when dependencies are down so traffic can drain elsewhere.
 */
healthRouter.get('/health/ready', async (_req, res) => {
  const start = Date.now();
  try {
    const [pong] = await Promise.all([
      redis.ping(),
      db.execute(sql`SELECT 1`),
    ]);

    const latency = Date.now() - start;

    if (pong !== 'PONG') {
      throw new Error('redis_ping_failed');
    }

    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: { redis: 'ok', postgres: 'ok' },
      latency: { db: latency },
    });
  } catch (err) {
    logger.error('Readiness check failed', {
      error: err instanceof Error ? err.message : String(err),
      latency: Date.now() - start,
    });
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
    });
  }
});


