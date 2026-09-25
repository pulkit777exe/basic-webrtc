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
  return new PublishBuffer({
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
    onDrop: (dropped, size) =>
      logger.warn('[WS] publish queue full, dropped oldest', { dropped, size }),
    onCircuitOpen: () =>
      logger.error('[WS] Redis publish circuit open — cross-node fan-out degraded to local only'),
    onCircuitClose: () => logger.info('[WS] Redis publish circuit closed, fan-out restored'),
  });
}
