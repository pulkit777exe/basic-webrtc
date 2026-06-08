/* eslint-disable @typescript-eslint/no-explicit-any */
import { redis } from '../config/redis.js';

// Upstash Redis client doesn't expose stream methods (xadd, xrange, xtrim) in its type definitions.
// These casts are required until Upstash adds stream command types.

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
  const entries: Array<[string, string[]]> = await (redis as any).xrange(key, '-', '+', count);
  return entries.map(([id, fields]) => {
    const payloadIdx = fields.findIndex((f) => f === 'payload');
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