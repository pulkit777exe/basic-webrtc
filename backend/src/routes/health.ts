import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { redis } from "../config/redis";
import { logger } from "../lib/logger";

export const healthRouter = Router();

/** Liveness: process is up (use for load balancer “ping”). */
healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Readiness: Redis + Postgres reachable (use for orchestrator / rolling deploys).
 * Returns 503 when dependencies are down so traffic can drain elsewhere.
 */
healthRouter.get("/health/ready", async (_req, res) => {
  try {
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error("redis_ping_failed");
    }
    await db.execute(sql`SELECT 1`);
    res.json({
      status: "ready",
      timestamp: new Date().toISOString(),
      checks: { redis: "ok", postgres: "ok" },
    });
  } catch (err) {
    logger.error("Readiness check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(503).json({
      status: "not_ready",
      timestamp: new Date().toISOString(),
    });
  }
});
