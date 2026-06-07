import { db } from '../db';
import { rooms, users, userSessions } from '../db/schema';
import { deleteAllRoomKeys, roomParticipantsKey } from './redis-rooms';
import { redis } from '../config/redis';
import { logger } from './logger';
import { eq, and, lt } from 'drizzle-orm';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_ROOM_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const UNVERIFIED_USER_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const UNVERIFIED_USER_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export function startCleanupJob(): void {
  logger.info('Starting stale room cleanup job');

  async function runCleanup(): Promise<void> {
    logger.info('Running stale room cleanup');

    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_ROOM_THRESHOLD_MS);

    // Query for active rooms that haven't been updated in the last 2 hours
    const staleRooms = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.status, 'active'), lt(rooms.updatedAt, staleThreshold)));

    logger.info(`Found ${staleRooms.length} stale rooms to check`);

    for (const room of staleRooms) {
      try {
        // Check Redis for active participants
        const participantCount = await redis.scard(roomParticipantsKey(room.id));

        if (participantCount === 0) {
          logger.info(`Marking room ${room.id} as ended (no active participants)`);

          // Mark room as ended in PostgreSQL
          await db
            .update(rooms)
            .set({
              status: 'ended',
              endedAt: now,
            })
            .where(eq(rooms.id, room.id));

          // Cleanup Redis keys
          await deleteAllRoomKeys(room.id);
        }
      } catch (error) {
        logger.error(`Cleanup failed for room ${room.id}`, { error });
      }
    }
  }

  async function cleanupUnverifiedUsers(): Promise<void> {
    const threshold = new Date(Date.now() - UNVERIFIED_USER_THRESHOLD_MS);
    const deleted = await db
      .delete(users)
      .where(and(eq(users.emailVerified, false), lt(users.createdAt, threshold)))
      .returning({ id: users.id });

    if (deleted.length > 0) {
      logger.info('Deleted stale unverified users', { deletedCount: deleted.length });
    }
  }

  async function cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    const deleted = await db
      .delete(userSessions)
      .where(lt(userSessions.expiresAt, now))
      .returning({ id: userSessions.id });

    if (deleted.length > 0) {
      logger.info('Deleted expired user sessions', { deletedCount: deleted.length });
    }
  }

  const intervalId = setInterval(async () => {
    try {
      await runCleanup();
    } catch (error) {
      logger.error('Cleanup job failed', { error });
    }
  }, CLEANUP_INTERVAL_MS);

  const unverifiedUserIntervalId = setInterval(async () => {
    try {
      await cleanupUnverifiedUsers();
      await cleanupExpiredSessions();
    } catch (error) {
      logger.error('Daily cleanup failed', { error });
    }
  }, UNVERIFIED_USER_CLEANUP_INTERVAL_MS);

  // Run once immediately on startup
  runCleanup().catch((error) => logger.error('Initial cleanup run failed', { error }));
  cleanupUnverifiedUsers().catch((error) =>
    logger.error('Initial unverified user cleanup failed', { error }),
  );
  cleanupExpiredSessions().catch((error) =>
    logger.error('Initial expired sessions cleanup failed', { error }),
  );

  // Handle shutdown
  process.on('SIGINT', () => {
    logger.info('Stopping cleanup job');
    clearInterval(intervalId);
    clearInterval(unverifiedUserIntervalId);
    process.exit(0);
  });
}
