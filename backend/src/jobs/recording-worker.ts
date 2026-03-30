import { Queue, Worker } from 'bullmq';
import { mergeRecordings } from '../services/recording-merge';
import { setRecordingState } from '../lib/redis-rooms';
import { publishSignal } from '../lib/redis-streams';
import { db } from '../db';
import { recordingSessions } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create new BullMQ connection options
const connectionOptions = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port || '6379'),
  password: new URL(REDIS_URL).password,
};

export const mergeQueue = new Queue('recording-merge', {
  connection: connectionOptions,
});

export function startRecordingWorker() {
  const worker = new Worker(
    'recording-merge',
    async (job) => {
      const { roomId, sessionId, tracks } = job.data;

      try {
        // 1. Update Redis state → merging
        await setRecordingState(roomId, { status: 'merging' });

        // 2. Update PostgreSQL recording_sessions → status merging
        try {
          await db
            .update(recordingSessions)
            .set({ status: 'merging' })
            .where(
              and(eq(recordingSessions.roomId, roomId), eq(recordingSessions.sessionId, sessionId)),
            );
        } catch (dbError) {
          console.error('Failed to update recording session status in PostgreSQL:', dbError);
          await setRecordingState(roomId, { status: 'failed' });
          await publishSignal(roomId, {
            type: 'recording_failed',
            error: (dbError as Error).message,
          });
          throw dbError;
        }

        // 3. Run FFmpeg merge
        let outputPath;
        try {
          outputPath = await mergeRecordings(roomId, sessionId, tracks);
        } catch (mergeError) {
          console.error('FFmpeg merge failed:', mergeError);
          await setRecordingState(roomId, { status: 'failed' });
          await publishSignal(roomId, { type: 'recording_failed', error: 'Merge failed' });
          throw mergeError;
        }

        // 4. Update Redis state → done, set outputPath
        await setRecordingState(roomId, {
          status: 'done',
          outputPath,
        });

        // 5. Update PostgreSQL recording_sessions → status done, set output_path
        await db
          .update(recordingSessions)
          .set({
            status: 'done',
            outputPath: outputPath,
          })
          .where(
            and(eq(recordingSessions.roomId, roomId), eq(recordingSessions.sessionId, sessionId)),
          );

        // 6. Notify host via publishSignal:
        await publishSignal(roomId, {
          type: 'recording_ready',
          downloadUrl: `/api/recordings/${sessionId}/download`,
        });
      } catch (error) {
        console.error('Recording worker error:', error);
        await setRecordingState(roomId, { status: 'failed' });
        await publishSignal(roomId, { type: 'recording_failed', error: (error as Error).message });
        throw error; // Re-throw to mark BullMQ job as failed
      }
    },
    {
      connection: connectionOptions,
      concurrency: 2, // max 2 FFmpeg jobs at once
    },
  );

  return worker;
}
