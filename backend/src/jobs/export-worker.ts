import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { Worker } from 'bullmq';
import archiver from 'archiver';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db';
import {
  loginEvents,
  messages,
  recordingSessions,
  roomParticipants,
  rooms,
  users,
} from '../db/schema';
import { redis } from '../config/redis';
import { queueEmail } from '../services/email';
import { accountQueueConnection } from './account-jobs';

interface ExportJobData {
  userId: string;
}

function getBackendBaseUrl(): string {
  const configured =
    process.env.BACKEND_URL ||
    process.env.API_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 4000}`;
  return configured.replace(/\/$/, '');
}

async function createExportArchive(userId: string): Promise<{ filePath: string; token: string }> {
  const exportsDir = path.resolve('/tmp/exports');
  await mkdir(exportsDir, { recursive: true });

  const timestamp = Date.now();
  const fileName = `${userId}-${timestamp}.zip`;
  const filePath = path.join(exportsDir, fileName);

  const [profile] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      emailVerified: users.emailVerified,
      recoveryEmail: users.recoveryEmail,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!profile) {
    throw new Error('User not found for export');
  }

  const hostedRooms = await db
    .select({
      id: rooms.id,
      title: rooms.title,
      status: rooms.status,
      createdAt: rooms.createdAt,
      endedAt: rooms.endedAt,
      isLocked: rooms.isLocked,
      maxParticipants: rooms.maxParticipants,
    })
    .from(rooms)
    .where(eq(rooms.hostId, userId));

  const attendedMeetings = await db
    .select({
      roomId: roomParticipants.roomId,
      role: roomParticipants.role,
      joinedAt: roomParticipants.joinedAt,
      leftAt: roomParticipants.leftAt,
      roomTitle: rooms.title,
      roomCreatedAt: rooms.createdAt,
    })
    .from(roomParticipants)
    .leftJoin(rooms, eq(roomParticipants.roomId, rooms.id))
    .where(eq(roomParticipants.userId, userId));

  const chatMessages = await db
    .select({
      id: messages.id,
      roomId: messages.roomId,
      content: messages.content,
      type: messages.type,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.userId, userId));

  const recordings = await db
    .select({
      id: recordingSessions.id,
      roomId: recordingSessions.roomId,
      sessionId: recordingSessions.sessionId,
      startedAt: recordingSessions.startedAt,
      endedAt: recordingSessions.endedAt,
      status: recordingSessions.status,
      participantCount: recordingSessions.participantCount,
      outputPath: recordingSessions.outputPath,
      createdAt: recordingSessions.createdAt,
    })
    .from(recordingSessions)
    .where(eq(recordingSessions.startedBy, userId));

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const recentLogins = await db
    .select({
      ipAddress: loginEvents.ipAddress,
      country: loginEvents.country,
      city: loginEvents.city,
      browser: loginEvents.browser,
      os: loginEvents.os,
      deviceType: loginEvents.deviceType,
      isSuspicious: loginEvents.isSuspicious,
      suspiciousReasons: loginEvents.suspiciousReasons,
      createdAt: loginEvents.createdAt,
    })
    .from(loginEvents)
    .where(and(eq(loginEvents.userId, userId), gt(loginEvents.createdAt, ninetyDaysAgo)))
    .orderBy(loginEvents.createdAt);

  const payloads = [
    { name: 'profile.json', data: profile },
    {
      name: 'meetings.json',
      data: {
        hostedRooms,
        attendedMeetings,
      },
    },
    { name: 'messages.json', data: chatMessages },
    { name: 'recordings.json', data: recordings },
    { name: 'login_history.json', data: recentLogins },
  ];

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    for (const item of payloads) {
      archive.append(JSON.stringify(item.data, null, 2), { name: item.name });
    }
    void archive.finalize();
  });

  const token = randomBytes(24).toString('hex');
  await redis.set(`export:download:${token}`, filePath, { ex: 24 * 60 * 60 });

  return { filePath, token };
}

export function startExportWorker() {
  const worker = new Worker<ExportJobData>(
    'account-export',
    async (job) => {
      const { userId } = job.data;
      const [user] = await db
        .select({
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return;
      }

      const { token } = await createExportArchive(userId);
      const downloadUrl = `${getBackendBaseUrl()}/api/account/export/download?token=${token}`;

      await queueEmail({
        to: user.email,
        template: 'data_export_ready',
        data: {
          userName: user.name,
          downloadUrl,
          expiresInHours: 24,
        },
      });
    },
    {
      connection: accountQueueConnection,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, error) => {
    console.error('[Export Worker Failed]', job?.id, error);
  });

  return worker;
}
