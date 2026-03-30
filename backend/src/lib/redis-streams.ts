import { redis } from '../config/redis.js';

const STREAM_KEY_PREFIX = 'signals';
const DEFAULT_MAX_STREAM_LENGTH = 500;
const DEFAULT_POLLING_INTERVAL = 100;
const MAX_POLLING_INTERVAL = 1000;

function streamKey(roomId: string): string {
  return `${STREAM_KEY_PREFIX}:${roomId}`;
}

// Publish a signal to a room's stream
export async function publishSignal(roomId: string, signal: object): Promise<string> {
  const key = streamKey(roomId);
  const result = await redis.xadd(
    key,
    'MAXLEN',
    '~',
    DEFAULT_MAX_STREAM_LENGTH,
    '*',
    'payload',
    JSON.stringify(signal),
  );
  if (!result) {
    throw new Error('Failed to publish signal');
  }
  return result;
}

// Read new signals for a room since a given ID
export async function readSignals(
  roomId: string,
  lastSeenId: string,
  count: number = 100,
): Promise<Array<{ id: string; payload: object }>> {
  const key = streamKey(roomId);
  const rangeStart = lastSeenId === '0' ? '-' : lastSeenId === '$' ? '$' : `${lastSeenId}+`;
  const rangeEnd = '+';

  const results = await redis.xrange(key, rangeStart, rangeEnd, 'COUNT', count);

  return results.map(([id, fields]) => {
    const payloadStr = fields.find((field, index) => index % 2 === 0 && field === 'payload');
    const payloadIndex = fields.indexOf(payloadStr!);
    const payload = JSON.parse(fields[payloadIndex + 1]);
    return { id, payload };
  });
}

// Trim stream to avoid unbounded growth
export async function trimStream(
  roomId: string,
  maxLen: number = DEFAULT_MAX_STREAM_LENGTH,
): Promise<void> {
  const key = streamKey(roomId);
  await redis.xtrim(key, 'MAXLEN', '~', maxLen);
}

// Delete stream on room end
export async function deleteStream(roomId: string): Promise<void> {
  await redis.del(streamKey(roomId));
}

// Polling function that returns a stop function
export function startStreamPoller(
  roomId: string,
  lastSeenId: string,
  onSignal: (signal: { id: string; payload: object }) => void,
  onError: (error: Error) => void,
): () => void {
  let isRunning = true;
  let currentPollingInterval = DEFAULT_POLLING_INTERVAL;

  async function poll() {
    if (!isRunning) return;

    try {
      const signals = await readSignals(roomId, lastSeenId, DEFAULT_MAX_STREAM_LENGTH);

      if (signals.length > 0) {
        signals.forEach(onSignal);
        lastSeenId = signals[signals.length - 1].id;
        currentPollingInterval = DEFAULT_POLLING_INTERVAL; // Reset to fast polling if we got signals
      } else {
        // Back off polling if no signals
        currentPollingInterval = Math.min(currentPollingInterval * 2, MAX_POLLING_INTERVAL);
      }
    } catch (error) {
      onError(error as Error);
      currentPollingInterval = Math.min(currentPollingInterval * 2, MAX_POLLING_INTERVAL); // Back off on error
    }

    setTimeout(poll, currentPollingInterval);
  }

  poll();

  return () => {
    isRunning = false;
  };
}
