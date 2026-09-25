/**
 * Buffered, bounded, circuit-broken Redis fan-out for WebSocket publishes.
 *
 * Every publish used to be its own Upstash REST call, fired and forgotten from
 * `handleMessage`. That is fine at a trickle and bad in a burst: a busy room
 * turns into hundreds of in-flight HTTP requests, and when Redis is unhealthy
 * those requests queue up rather than failing fast.
 *
 * This buffer keeps the hot path synchronous (local delivery is untouched and
 * still immediate) and moves cross-node fan-out behind three protections:
 *
 * - **Batching**: payloads accumulate per channel and leave in one multi/exec,
 *   preserving per-channel order.
 * - **Backpressure**: the queue is bounded; past the cap the oldest entries are
 *   dropped and counted, because a stale realtime notification is cheaper than
 *   an unbounded memory leak. (Durable content — chat — is persisted before it
 *   is published, so a drop costs a live update, not data.)
 * - **Circuit breaker**: after N consecutive failed flushes, publishing stops
 *   entirely for a cool-off period, then one trial flush decides whether to
 *   resume.
 */

export interface PublishBufferOptions {
  /** Send one batch. Must preserve per-channel ordering. */
  publishBatch: (channels: Map<string, string[]>) => Promise<unknown>;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  /** Consecutive failed flushes before the circuit opens. */
  failureThreshold?: number;
  /** How long the circuit stays open before a trial flush is allowed. */
  resetAfterMs?: number;
  now?: () => number;
  onDrop?: (dropped: number, size: number) => void;
  onCircuitOpen?: () => void;
  onCircuitClose?: () => void;
}

export class PublishBuffer {
  private queues = new Map<string, string[]>();
  private queued = 0;
  private dropped = 0;
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;
  private isOpen = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;
  private readonly now: () => number;

  constructor(private readonly options: PublishBufferOptions) {
    this.flushIntervalMs = options.flushIntervalMs ?? 50;
    this.maxQueueSize = options.maxQueueSize ?? 1_000;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetAfterMs = options.resetAfterMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.queued;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  get circuitOpen(): boolean {
    return this.isOpen;
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queues.clear();
    this.queued = 0;
  }

  /** Enqueue a payload. Synchronous and allocation-cheap: never throws. */
  publish(channel: string, payload: string): void {
    if (this.stopped || this.isOpen) return;
    this.enqueue(channel, payload);
  }

  /** Drain and send. Concurrent calls share one in-flight batch. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) return this.inFlight;

    const wasOpen = this.isOpen;
    if (wasOpen) {
      // Cool-off elapsed? Send whatever is queued — even nothing — because the
      // trial has to be a real round trip: closing on an empty queue would
      // claim Redis is healthy without having asked it.
      if (this.now() - this.circuitOpenedAt < this.resetAfterMs) return;
      this.isOpen = false;
    }

    if (this.queued === 0 && !wasOpen) return;

    const batch = this.queues;
    this.queues = new Map();
    this.queued = 0;

    this.inFlight = (async () => {
      try {
        await this.options.publishBatch(batch);
        this.consecutiveFailures = 0;
        if (wasOpen) this.options.onCircuitClose?.();
      } catch {
        // The batch is dropped rather than requeued: during an outage,
        // requeueing is exactly the unbounded growth this buffer exists to
        // prevent. Durable content is persisted before it is published.
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.failureThreshold && !this.isOpen) {
          this.isOpen = true;
          this.circuitOpenedAt = this.now();
          this.options.onCircuitOpen?.();
        }
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  private enqueue(channel: string, payload: string): void {
    while (this.queued >= this.maxQueueSize) {
      this.dropOldest();
    }
    const queue = this.queues.get(channel);
    if (queue) {
      queue.push(payload);
    } else {
      this.queues.set(channel, [payload]);
    }
    this.queued += 1;
  }

  private dropOldest(): void {
    for (const [channel, queue] of this.queues) {
      const removed = queue.shift();
      if (queue.length === 0) this.queues.delete(channel);
      this.queued -= 1;
      this.dropped += 1;
      this.options.onDrop?.(1, this.queued);
      if (removed !== undefined) return;
    }
  }
}
