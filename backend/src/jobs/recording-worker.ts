import { Worker } from 'bullmq';
import { setRecordingState } from '../lib/redis-rooms';
import { publishSignal } from '../lib/redis-streams';
import { clearRecordingStatus } from '../services/recording-broadcast';
import { db } from '../db';
import { recordingSessions } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const REDIS_URL = process.env.REDIS_URL;

function getConnectionOptions() {
  if (!REDIS_URL) return null;
  return {
    host: new URL(REDIS_URL).hostname,
    port: parseInt(new URL(REDIS_URL).port || '6379'),
    password: new URL(REDIS_URL).password,
  };
}

export function startRecordingWorker() {
  const connectionOptions = getConnectionOptions();
  if (!connectionOptions) {
    console.warn('[RecordingWorker] REDIS_URL not set, recording worker disabled');
    return;
  }

  const worker = new Worker(
    'recording-merge',
    async (job) => {
      const { roomId, sessionId } = job.data;

      try {
        // Recordings are now client-side only.
        // Just update state to done and notify the room.
        await setRecordingState(roomId, { status: 'done' });

        await db
          .update(recordingSessions)
          .set({ status: 'done' })
          .where(
            and(eq(recordingSessions.roomId, roomId), eq(recordingSessions.sessionId, sessionId)),
          );

        await publishSignal(roomId, {
          type: 'recording_done',
          sessionId,
        });

        await clearRecordingStatus(roomId, sessionId);
      } catch (error) {
        console.error('Recording worker error:', error);
        await setRecordingState(roomId, { status: 'failed' });
        await publishSignal(roomId, { type: 'recording_failed', error: (error as Error).message });
        throw error;
      }
    },
    {
      connection: connectionOptions,
      concurrency: 2,
    },
  );

  return worker;
}
