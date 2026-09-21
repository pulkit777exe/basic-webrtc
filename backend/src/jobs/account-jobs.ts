import { Queue } from 'bullmq';
import { and, isNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { deletionRequests } from '../db/schema';

/**
 * Job queue abstraction with free-tier fallback.
 *
 * - When `REDIS_URL` (TCP Redis) is set, jobs go through BullMQ as before —
 *   use this for multi-instance / paid deployments.
 * - When it is NOT set (Render free plan: no TCP Redis, Upstash REST only —
 *   BullMQ's Lua scripts and blocking commands don't work over REST), jobs
 *   run in-process on this single instance:
 *   - exports run immediately via `runExportJob` (detached promise);
 *   - deletions are recorded in Postgres with `scheduledFor` and picked up by
 *     `startAccountFallbackPoller()`, which survives restarts and Render's
 *     sleep/wake cycles (a 30-day `setTimeout` would not).
 *
 * Both processors are idempotent (they re-check cancelled/processed state),
 * so the BullMQ worker and the poller can safely coexist during migration.
 */

const REDIS_URL = process.env.REDIS_URL;

function buildConnectionOptions() {
  if (!REDIS_URL) return null;
  const parsed = new URL(REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

let _exportQueue: Queue | null = null;
let _deletionQueue: Queue | null = null;

function getExportQueue(): Queue | null {
  const conn = buildConnectionOptions();
  if (!conn) return null;
  if (!_exportQueue) _exportQueue = new Queue('account-export', { connection: conn });
  return _exportQueue;
}

function getDeletionQueue(): Queue | null {
  const conn = buildConnectionOptions();
  if (!conn) return null;
  if (!_deletionQueue) _deletionQueue = new Queue('account-deletion', { connection: conn });
  return _deletionQueue;
}

export function getAccountQueueConnection() {
  return buildConnectionOptions();
}

export interface EnqueuedJob {
  id: string;
}

/** Enqueue a GDPR export. Never 503s: falls back to in-process execution. */
export async function enqueueExport(userId: string): Promise<EnqueuedJob> {
  const queue = getExportQueue();
  if (queue) {
    const job = await queue.add(
      'export',
      { userId },
      { attempts: 2, removeOnComplete: 50, removeOnFail: 20 },
    );
    return { id: String(job.id) };
  }
  // Free-tier single-instance path: process inline, detached.
  const { runExportJob } = await import('./export-worker');
  void runExportJob(userId).catch((err) => {
    console.error('[Export] In-process export failed', { userId, err: String(err) });
  });
  return { id: `inline-${userId}-${Date.now()}` };
}

/**
 * Schedule account deletion after `delayMs`. With BullMQ this is a delayed
 * job; on the free tier the `scheduledFor` row in Postgres is the schedule and
 * `startAccountFallbackPoller()` executes it when due.
 */
export async function enqueueDeletion(
  userId: string,
  deletionRequestId: string,
  delayMs: number,
): Promise<EnqueuedJob> {
  const queue = getDeletionQueue();
  if (queue) {
    const job = await queue.add(
      'delete',
      { userId, deletionRequestId },
      { delay: delayMs, removeOnComplete: 50, removeOnFail: 20 },
    );
    return { id: String(job.id) };
  }
  return { id: `deferred-${deletionRequestId}` };
}

/** Cancel a scheduled deletion. No-op for free-tier deferred jobs (the
 *  cancel-deletion route marks the DB row cancelled, which the poller respects). */
export async function cancelDeletionJob(jobId: string): Promise<void> {
  if (jobId.startsWith('deferred-') || jobId.startsWith('inline-')) return;
  const queue = getDeletionQueue();
  if (!queue) return;
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

const DELETION_POLLER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DELETION_POLLER_INITIAL_DELAY_MS = 30 * 1000; // catch up shortly after boot/wake

async function runDeletionPollerOnce(): Promise<void> {
  const now = new Date();
  const due = await db
    .select({ id: deletionRequests.id, userId: deletionRequests.userId })
    .from(deletionRequests)
    .where(
      and(
        isNull(deletionRequests.cancelledAt),
        isNull(deletionRequests.processedAt),
        lte(deletionRequests.scheduledFor, now),
      ),
    );
  if (due.length === 0) return;
  const { runDeletionJob } = await import('./deletion-worker');
  for (const row of due) {
    if (!row.userId) continue;
    try {
      await runDeletionJob(row.userId, row.id);
    } catch (err) {
      console.error('[Deletion] Poller run failed', {
        deletionRequestId: row.id,
        err: String(err),
      });
    }
  }
}

/**
 * Start the DB-backed deletion poller. Always safe to run — even alongside
 * BullMQ workers, since `runDeletionJob` skips already-processed/cancelled
 * requests. Required on the free tier where BullMQ is unavailable.
 */
export function startAccountFallbackPoller(): void {
  const poll = () => {
    runDeletionPollerOnce().catch((err) => {
      console.error('[Deletion] Poller failed', { err: String(err) });
    });
  };
  setTimeout(poll, DELETION_POLLER_INITIAL_DELAY_MS);
  setInterval(poll, DELETION_POLLER_INTERVAL_MS);
}
