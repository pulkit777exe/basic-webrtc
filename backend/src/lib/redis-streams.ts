/* eslint-disable @typescript-eslint/no-explicit-any */
import { redis } from '../config/redis.js';

function streamKey(roomId: string): string {
  return `signals:${roomId}`;
}

export async function publishSignal(roomId: string, signal: object): Promise<string> {
  const key = streamKey(roomId);
  const payload = JSON.stringify(signal);
  const result = await (redis as any).xadd(key, '*', 'payload', payload);
  if (!result) {
    throw new Error('Failed to publish signal');
  }
  const len = await redis.xlen(key);
  if (len > 500) {
    await (redis as any).xtrim(key, 'MAXLEN', '~', 500);
  }
  return result;
}

export async function readSignals(
  roomId: string,
  _lastSeenId: string,
  count: number = 100,
): Promise<Array<{ id: string; payload: object }>> {
  const key = streamKey(roomId);
  const entries = await (redis as any).xrange(key, '-', '+', count);
  const typed = entries as any;
  return typed.map((entry: any[]) => {
    const [id, fields] = entry;
    const payloadIdx = fields.findIndex((f: string) => f === 'payload');
    const payload = payloadIdx >= 0 ? JSON.parse(fields[payloadIdx + 1]) : {};
    return { id, payload };
  });
}

export async function trimStream(roomId: string, maxLen: number = 500): Promise<void> {
  const key = streamKey(roomId);
  await (redis as any).xtrim(key, 'MAXLEN', '~', maxLen);
}

export async function deleteStream(roomId: string): Promise<void> {
  await redis.del(streamKey(roomId));
}