/**
 * ICE candidates that arrived before their peer's remote description was set.
 *
 * Kept in one small object so the two things that must always happen together —
 * dropping the queue and cancelling its TTL timer — cannot drift apart. Doing
 * them by hand leaked timers: `restartIce` used to delete the queue but leave
 * the old timer armed, so it later fired against a *newly* queued batch and
 * dropped candidates mid-negotiation.
 */

export interface PendingIceOptions {
  /** Drop the oldest candidate past this many queued for one peer. */
  maxPerPeer?: number;
  /** Forget a queue nobody ever drained. */
  ttlMs?: number;
  onTimeout?: (userId: string) => void;
}

export class PendingIceQueue {
  private readonly queues = new Map<string, RTCIceCandidateInit[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly maxPerPeer: number;
  private readonly ttlMs: number;
  private readonly onTimeout: ((userId: string) => void) | undefined;

  constructor(options: PendingIceOptions = {}) {
    this.maxPerPeer = options.maxPerPeer ?? 50;
    this.ttlMs = options.ttlMs ?? 30_000;
    this.onTimeout = options.onTimeout;
  }

  /** Peers with candidates still queued — used for session-wide teardown. */
  get peers(): string[] {
    return [...this.queues.keys()];
  }

  size(userId: string): number {
    return this.queues.get(userId)?.length ?? 0;
  }

  push(userId: string, candidate: RTCIceCandidateInit): void {
    let queue = this.queues.get(userId);
    if (!queue) {
      queue = [];
      this.queues.set(userId, queue);
      this.timers.set(
        userId,
        setTimeout(() => {
          this.clear(userId);
          this.onTimeout?.(userId);
        }, this.ttlMs)
      );
    }
    if (queue.length >= this.maxPerPeer) queue.shift(); // drop oldest
    queue.push(candidate);
  }

  /** Hand back everything queued for a peer and stop its timer. */
  take(userId: string): RTCIceCandidateInit[] {
    const queue = this.queues.get(userId);
    this.clear(userId);
    return queue ?? [];
  }

  /** Forget a peer's queue *and* its timer. */
  clear(userId: string): void {
    this.queues.delete(userId);
    const timer = this.timers.get(userId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(userId);
    }
  }

  clearAll(): void {
    for (const userId of this.peers) this.clear(userId);
  }
}
