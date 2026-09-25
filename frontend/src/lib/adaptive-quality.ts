/**
 * Drives adaptive camera resolution during a call.
 *
 * Polls uplink estimates from every peer connection, reduces them to the binding
 * constraint (the worst link — one uplink serves the whole mesh), asks
 * {@link chooseQuality} what to do, and applies the result to the local capture
 * track.
 *
 * All I/O is injected so the whole loop — including the timer, the stats calls,
 * and the constraint application — is testable without a browser.
 */

import {
  VIDEO_QUALITY_LADDER,
  chooseQuality,
  combineOutgoingBitrate,
  type AdaptationDecision,
  type QualityLevel,
  type VideoQualityCap,
} from './bandwidth';

export const DEFAULT_POLL_INTERVAL_MS = 5_000;

export interface AdaptiveQualityOptions {
  /** One uplink sample per peer connection (null when unmeasurable). */
  getSamples: () => Promise<Array<number | null>>;
  /** Apply a rung to the local capture track. */
  applyLevel: (level: QualityLevel) => Promise<void> | void;
  getCap: () => VideoQualityCap;
  isScreenSharing: () => boolean;
  pollIntervalMs?: number;
  now?: () => number;
  onDecision?: (decision: AdaptationDecision, bitrate: number | null) => void;
  onError?: (error: unknown) => void;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export class AdaptiveQualityController {
  private timer: unknown = null;
  private index = 0;
  private lastChangeAt: number | null = null;
  private stopped = false;
  private ticking = false;

  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: (handler: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;

  constructor(private readonly options: AdaptiveQualityOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.setIntervalFn =
      options.setInterval ?? ((handler, ms) => globalThis.setInterval(handler, ms));
    this.clearIntervalFn =
      options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as number));
  }

  /** Current ladder index (0 = best). Exposed for tests and diagnostics. */
  get currentIndex(): number {
    return this.index;
  }

  start(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = this.setIntervalFn(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /**
   * One evaluation. Exposed so tests can drive it deterministically instead of
   * racing the timer.
   */
  async tick(): Promise<AdaptationDecision | null> {
    if (this.stopped) return null;
    // Never overlap polls: getStats on every peer is not free, and a slow
    // report must not queue up behind the next tick.
    if (this.ticking) return null;
    this.ticking = true;

    try {
      const samples = await this.options.getSamples();
      const bitrate = combineOutgoingBitrate(samples ?? []);
      const decision = chooseQuality({
        availableOutgoingBitrate: bitrate,
        currentIndex: this.index,
        cap: this.options.getCap(),
        screenSharing: this.options.isScreenSharing(),
        now: this.now(),
        lastChangeAt: this.lastChangeAt,
      });

      this.options.onDecision?.(decision, bitrate);

      if (decision.changed) {
        const level = VIDEO_QUALITY_LADDER[decision.index]!;
        await this.options.applyLevel(level);
        this.index = decision.index;
        this.lastChangeAt = this.now();
      }
      return decision;
    } catch (error) {
      this.options.onError?.(error);
      return null;
    } finally {
      this.ticking = false;
    }
  }
}
