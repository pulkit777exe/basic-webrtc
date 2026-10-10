import { redis } from '../config/redis';
import { logger } from './logger';
import { PublishBuffer } from './publish-buffer';

/**
 * The cross-node fan-out buffer for room traffic.
 *
 * Shared by the signaling handler and the live-captions bridge so every
 * Redis publish from a WebSocket goes through the same batching, bounded queue,
 * and circuit breaker. Local delivery never waits on it.
 */
export function createRoomFanoutBuffer(): PublishBuffer {
  // Declared first so the log callbacks can read its counters: they only fire
  // after construction, but referencing the const in its own initializer is a
  // temporal dead zone error.
  let buffer: PublishBuffer;
  buffer = new PublishBuffer({
    // One MULTI/EXEC per flush, preserving per-channel order.
    publishBatch: async (channels) => {
      const tx = redis.multi();
      for (const [channel, payloads] of channels) {
        for (const payload of payloads) tx.publish(channel, payload);
      }
      await tx.exec();
    },
    // A real round trip, so a tripped circuit recovers even on a quiet room.
    // (Probing with an empty transaction fails on the Redis client.)
    probe: async () => {
      await redis.ping();
    },
    // Counts ride along so fan-out is observable: a publish count that stalls
    // while chat still persists is a cross-node problem, and a climbing drop
    // count is a queue too small for the room's traffic.
    onDrop: (dropped, size) =>
      logger.warn('[WS] publish queue full, dropped oldest', {
        dropped,
        size,
        published: buffer.publishedCount,
      }),
    onCircuitOpen: () =>
      logger.error('[WS] Redis publish circuit open — cross-node fan-out degraded to local only', {
        published: buffer.publishedCount,
        dropped: buffer.droppedCount,
      }),
    onCircuitClose: () =>
      logger.info('[WS] Redis publish circuit closed, fan-out restored', {
        published: buffer.publishedCount,
      }),
  });
  return buffer;
}

/**
 * The lightweight lane for high-frequency advisory traffic (`media-state`,
 * `audio-activity`, `active_speaker` — see the `lane` field in
 * `MESSAGE_POLICY`). Same transport, separate queue and breaker: a burst of
 * state updates at 10/s/connection must not fill the buffer chat relies on,
 * and a wedged transport trips this lane without taking chat down with it.
 *
 * Tuned differently on purpose: advisory goes stale within a frame or two, so
 * it flushes twice as often with a fifth of the queue — a drop here costs a
 * live update, never data, because the next tick self-corrects.
 */
export function createPresenceFanoutBuffer(): PublishBuffer {
  let buffer: PublishBuffer;
  buffer = new PublishBuffer({
    publishBatch: async (channels) => {
      const tx = redis.multi();
      for (const [channel, payloads] of channels) {
        for (const payload of payloads) tx.publish(channel, payload);
      }
      await tx.exec();
    },
    probe: async () => {
      await redis.ping();
    },
    flushIntervalMs: 25,
    maxQueueSize: 200,
    onDrop: (dropped, size) =>
      logger.warn('[WS presence] publish queue full, dropped oldest', {
        dropped,
        size,
        published: buffer.publishedCount,
      }),
    onCircuitOpen: () =>
      logger.error('[WS presence] Redis publish circuit open — advisory fan-out degraded to local only', {
        published: buffer.publishedCount,
        dropped: buffer.droppedCount,
      }),
    onCircuitClose: () =>
      logger.info('[WS presence] Redis publish circuit closed, advisory fan-out restored', {
        published: buffer.publishedCount,
      }),
  });
  return buffer;
}
