import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import {
  backupCodes,
  deletionRequests,
  loginEvents,
  messages,
  otpCodes,
  passwordResetTokens,
  recordingSessions,
  recordingTracks,
  roomParticipants,
  rooms,
  userSessions,
  users,
} from '../db/schema';
import { accountQueueConnection } from './account-jobs';

interface DeletionJobData {
  userId: string;
  deletionRequestId: string;
}

const DELETED_USER_EMAIL = 'deleted-user@deleted.local';

async function getOrCreateDeletedUserId(): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DELETED_USER_EMAIL))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [inserted] = await db
    .insert(users)
    .values({
      email: DELETED_USER_EMAIL,
      name: 'Deleted User',
      emailVerified: true,
    })
    .returning({ id: users.id });

  return inserted.id;
}

export function startDeletionWorker() {
  const worker = new Worker<DeletionJobData>(
    'account-deletion',
    async (job) => {
      const { userId, deletionRequestId } = job.data;
      const [request] = await db
        .select({
          id: deletionRequests.id,
          userId: deletionRequests.userId,
          originalEmail: deletionRequests.originalEmail,
          cancelledAt: deletionRequests.cancelledAt,
          processedAt: deletionRequests.processedAt,
        })
        .from(deletionRequests)
        .where(eq(deletionRequests.id, deletionRequestId))
        .limit(1);

      if (!request || request.cancelledAt || request.processedAt) {
        return;
      }

      const deletedUserId = await getOrCreateDeletedUserId();
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx.update(messages).set({ userId: deletedUserId }).where(eq(messages.userId, userId));

        await tx
          .update(recordingTracks)
          .set({ participantId: null })
          .where(eq(recordingTracks.participantId, userId));

        await tx
          .update(recordingSessions)
          .set({ startedBy: null })
          .where(eq(recordingSessions.startedBy, userId));

        await tx
          .update(rooms)
          .set({
            hostId: deletedUserId,
            status: 'ended',
            endedAt: now,
          })
          .where(eq(rooms.hostId, userId));

        await tx.delete(otpCodes).where(eq(otpCodes.email, request.originalEmail));
        await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
        await tx.delete(backupCodes).where(eq(backupCodes.userId, userId));
        await tx.delete(userSessions).where(eq(userSessions.userId, userId));
        await tx.delete(loginEvents).where(eq(loginEvents.userId, userId));
        await tx.delete(roomParticipants).where(eq(roomParticipants.userId, userId));

        await tx
          .update(deletionRequests)
          .set({ processedAt: now })
          .where(eq(deletionRequests.id, deletionRequestId));

        await tx
          .update(deletionRequests)
          .set({ userId: null })
          .where(eq(deletionRequests.id, deletionRequestId));

        await tx.delete(users).where(eq(users.id, userId));
      });
    },
    {
      connection: accountQueueConnection,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, error) => {
    console.error('[Deletion Worker Failed]', job?.id, error);
  });

  return worker;
}
