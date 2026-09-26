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
  /**
   * Liveness check used to close a tripped circuit (e.g. `redis.ping()`).
   * Required: the circuit must recover on a quiet room, and probing with an
   * empty batch fails on the Redis client, which would reopen it forever.
   */
  probe?: () => Promise<unknown>;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  /** Consecutive failed flushes before the circuit opens. */
  failureThreshold?: number;
  /** How long the circuit stays open before sending is retried. */
  resetAfterMs?: number;
  /** A send that takes longer than this counts as a failure. */
  timeoutMs?: number;
  now?: () => number;
  onDrop?: (dropped: number, size: number) => void;
  onCircuitOpen?: () => void;
  onCircuitClose?: () => void;
}

export class PublishBuffer {
  private queues = new Map<string, string[]>();
  private queued = 0;
  private dropped = 0;
  /** Payloads successfully handed to the transport. */
  private published = 0;
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
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: PublishBufferOptions) {
    this.flushIntervalMs = options.flushIntervalMs ?? 50;
    this.maxQueueSize = options.maxQueueSize ?? 1_000;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetAfterMs = options.resetAfterMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.queued;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  /**
   * Payloads successfully sent, so fan-out is observable: a room whose publish
   * count stalls while chat still persists is a cross-node problem, and a rising
   * drop count is a queue that is too small for the room's traffic.
   */
  get publishedCount(): number {
    return this.published;
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

  /**
   * Drain what is queued, waiting out any batch already in flight (a single
   * `flush()` would return that batch and abandon the rest). Bounded so a
   * wedged transport cannot block shutdown.
   */
  async flushAll(maxRounds = 5): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      if (this.queued === 0 && !this.inFlight) return;
      await this.flush();
      // Let an in-flight batch settle before deciding whether more remains.
      await this.inFlight;
    }
  }

  /**
   * Enqueue a payload. Synchronous and allocation-cheap: never throws.
   *
   * Note this queues even while the circuit is open. An earlier version dropped
   * here, which meant the circuit could only ever be retried with an *empty*
   * batch — and since the transport rejects an empty transaction, a recovered
   * Redis could never close it. Queueing through an outage is bounded by
   * `maxQueueSize` and lets the first post-cooldown flush carry a real batch.
   */
  publish(channel: string, payload: string): void {
    if (this.stopped) return;
    if (this.isOpen) {
      this.dropped += 1;
      return;
    }
    this.enqueue(channel, payload);
  }

  /** Drain and send. Concurrent calls share one in-flight batch. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) return this.inFlight;

    if (this.isOpen) {
      if (this.now() - this.circuitOpenedAt < this.resetAfterMs) return;
      this.isOpen = false;
      this.inFlight = (async () => {
        try {
          await this.sendProbe();
          this.consecutiveFailures = 0;
          this.options.onCircuitClose?.();
        } catch {
          this.consecutiveFailures += 1;
          this.isOpen = true;
          this.circuitOpenedAt = this.now();
          this.options.onCircuitOpen?.();
        } finally {
          this.inFlight = null;
        }
      })();
      return this.inFlight;
    }
    if (this.queued === 0) return;

    const batch = this.queues;
    this.queues = new Map();
    this.queued = 0;

    this.inFlight = (async () => {
      try {
        await this.send(batch);
        let count = 0;
        for (const payloads of batch.values()) count += payloads.length;
        this.published += count;
        this.consecutiveFailures = 0;
      } catch {
        // The batch is dropped rather than requeued: during an outage,
        // requeueing is exactly the unbounded growth this buffer exists to
        // prevent. Callers must only put recoverable work in here.
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

  private async sendProbe(): Promise<void> {
    if (!this.options.probe) {
      throw new Error('PublishBuffer requires a probe() to close an open circuit');
    }
    await this.withTimeout(this.options.probe());
  }

  /**
   * Send with a deadline. Without it a hung REST request pins `inFlight`
   * forever: every later tick returns the same promise, the queue fills, and
   * the failure is never recorded.
   */
  private async send(batch: Map<string, string[]>): Promise<void> {
    await this.withTimeout(this.options.publishBatch(batch));
  }

  private async withTimeout(promise: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`publish batch timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
    });
    try {
      await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
