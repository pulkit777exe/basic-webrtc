import { redis } from '../config/redis';
import { roomSignalChannel, type RecordingState } from '../lib/redis-rooms';
import { nanoid } from 'nanoid';

const RECORDING_STATUS_TTL_SEC = 3600;

export interface RecordingStatus {
  roomId: string;
  sessionId: string;
  status: 'recording' | 'uploading' | 'merging' | 'done' | 'failed';
  startedAt: string;
  startedBy: string;
  participantCount: number;
  participantStates: {
    participantId: string;
    status: 'recording' | 'uploading' | 'uploaded' | 'failed';
    progress: number;
  }[];
  failedParticipants: string[];
}

export async function broadcastRecordingStarted(
  roomId: string,
  sessionId: string,
  startedBy: string,
  participantCount: number,
  participants: string[],
): Promise<void> {
  const status: RecordingStatus = {
    roomId,
    sessionId,
    status: 'recording',
    startedAt: new Date().toISOString(),
    startedBy,
    participantCount,
    participantStates: participants.map((id) => ({
      participantId: id,
      status: 'recording',
      progress: 0,
    })),
    failedParticipants: [],
  };

  const key = `recording:status:${roomId}:${sessionId}`;
  await redis.setex(key, RECORDING_STATUS_TTL_SEC, JSON.stringify(status));
}

export async function getRecordingStatus(
  roomId: string,
  sessionId: string,
): Promise<RecordingStatus | null> {
  const key = `recording:status:${roomId}:${sessionId}`;
  const raw = await redis.get<string>(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RecordingStatus;
  } catch {
    return null;
  }
}

export async function updateParticipantRecordingState(
  roomId: string,
  sessionId: string,
  participantId: string,
  state: 'recording' | 'uploading' | 'uploaded' | 'failed',
  progress: number,
): Promise<void> {
  const key = `recording:status:${roomId}:${sessionId}`;
  const raw = await redis.get<string>(key);
  if (!raw) return;

  try {
    const status = JSON.parse(raw) as RecordingStatus;
    const idx = status.participantStates.findIndex((p) => p.participantId === participantId);
    if (idx >= 0) {
      status.participantStates[idx] = { participantId, status, progress };
    }
    await redis.setex(key, RECORDING_STATUS_TTL_SEC, JSON.stringify(status));
  } catch {
    // ignore parse errors
  }
}

export async function markParticipantFailed(
  roomId: string,
  sessionId: string,
  participantId: string,
): Promise<void> {
  const key = `recording:status:${roomId}:${sessionId}`;
  const raw = await redis.get<string>(key);
  if (!raw) return;

  try {
    const status = JSON.parse(raw) as RecordingStatus;
    const idx = status.participantStates.findIndex((p) => p.participantId === participantId);
    if (idx >= 0) {
      status.participantStates[idx].status = 'failed';
      status.failedParticipants.push(participantId);
    }
    await redis.setex(key, RECORDING_STATUS_TTL_SEC, JSON.stringify(status));
  } catch {
    // ignore parse errors
  }
}

export async function checkAllUploaded(
  roomId: string,
  sessionId: string,
): Promise<{ allUploaded: boolean; uploadedCount: number; failedCount: number }> {
  const status = await getRecordingStatus(roomId, sessionId);
  if (!status) {
    return { allUploaded: false, uploadedCount: 0, failedCount: 0 };
  }

  const uploadedCount = status.participantStates.filter((p) => p.status === 'uploaded').length;
  const failedCount = status.failedParticipants.length;
  const threshold = Math.ceil(status.participantCount * 0.5);

  return {
    allUploaded: uploadedCount >= threshold,
    uploadedCount,
    failedCount,
  };
}

export async function clearRecordingStatus(
  roomId: string,
  sessionId: string,
): Promise<void> {
  const key = `recording:status:${roomId}:${sessionId}`;
  await redis.del(key);
}