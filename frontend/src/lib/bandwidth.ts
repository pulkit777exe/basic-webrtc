/**
 * Adaptive video quality for a mesh call.
 *
 * In full mesh every client uploads the same camera stream to every peer, so a
 * 720p30 stream to 8 peers is 8x the encoder output on the same uplink. The
 * only lever that reliably prevents dropped frames is lowering the *capture*
 * resolution before congestion turns into stutter.
 *
 * The decision is kept pure and separate from the WebRTC plumbing so it can be
 * tested exhaustively: thresholds, hysteresis, cooldowns, user caps, and the
 * screen-share exemption are all ordinary functions here.
 */

export interface QualityLevel {
  width: number;
  height: number;
  /** Rough encoder bitrate for this resolution at 30fps, in kbps. */
  maxBitrateKbps: number;
}

/** Index 0 is best. Ordered high to low; the last entry is the floor. */
export const VIDEO_QUALITY_LADDER: readonly QualityLevel[] = [
  { width: 1920, height: 1080, maxBitrateKbps: 2500 },
  { width: 1280, height: 720, maxBitrateKbps: 1200 },
  { width: 854, height: 480, maxBitrateKbps: 600 },
  { width: 640, height: 360, maxBitrateKbps: 300 },
] as const;

export type VideoQualityCap = 'auto' | '1080' | '720' | '480';

const CAP_MAX_HEIGHT: Record<VideoQualityCap, number> = {
  auto: Number.POSITIVE_INFINITY,
  '1080': 1080,
  '720': 720,
  '480': 480,
};

/** Degrade when headroom drops below this fraction of the level's bitrate. */
const DEGRADE_HEADROOM = 0.9;
/** Climb only with this much headroom over the next level — prevents flapping. */
const UPGRADE_HEADROOM = 1.5;
/** Ignore measurements closer together than this after a change. */
export const MIN_CHANGE_INTERVAL_MS = 10_000;

export type AdaptationReason = 'degraded' | 'upgraded' | 'capped' | 'held' | 'stable' | 'no-data';

export interface AdaptationInput {
  /** Measured uplink in bits/sec, or null/undefined when unavailable. */
  availableOutgoingBitrate?: number | null;
  /**
   * How many peers the local camera is being sent to. In a mesh the same
   * capture is uploaded once per peer, so the per-stream budget is the uplink
   * divided by this. Defaults to 1.
   */
  senderCount?: number;
  /** Current ladder index (0 = best). */
  currentIndex: number;
  cap: VideoQualityCap;
  /** Camera adaptation is paused while a screen share owns the uplink. */
  screenSharing?: boolean;
  now: number;
  lastChangeAt?: number | null;
}

export interface AdaptationDecision {
  index: number;
  changed: boolean;
  reason: AdaptationReason;
}

/**
 * Best (lowest-index) rung the user's cap allows. A cap is a ceiling on
 * quality, not a floor: "720" means never climb above 720p, but adaptation may
 * still drop below it when the link cannot carry 720p. This matches
 * `MediaManager`'s acquisition ladder, which keeps lower rungs as fallbacks.
 */
export function bestIndexForCap(cap: VideoQualityCap): number {
  const maxHeight = CAP_MAX_HEIGHT[cap];
  const index = VIDEO_QUALITY_LADDER.findIndex((level) => level.height <= maxHeight);
  // No rung at or below the cap (impossible with the current ladder): use the floor.
  return index === -1 ? VIDEO_QUALITY_LADDER.length - 1 : index;
}

function clampIndex(index: number): number {
  return Math.max(0, Math.min(index, VIDEO_QUALITY_LADDER.length - 1));
}

/**
 * Choose the ladder index to run at, given a measured uplink.
 *
 * Biased against flapping: climbing needs 1.5x headroom over the target level
 * (not just over the current one), and any change is subject to a cooldown, so
 * a link hovering near a threshold cannot oscillate the camera resolution.
 */
export function chooseQuality(input: AdaptationInput): AdaptationDecision {
  const currentIndex = clampIndex(input.currentIndex);
  const bestAllowed = bestIndexForCap(input.cap);
  const current = VIDEO_QUALITY_LADDER[currentIndex]!;

  // The user picked a cap and we are running above it: obey immediately,
  // without waiting for a bandwidth reading.
  if (currentIndex < bestAllowed) {
    return { index: bestAllowed, changed: true, reason: 'capped' };
  }

  // A screen share dominates the uplink; leave the camera alone.
  if (input.screenSharing) {
    return { index: currentIndex, changed: false, reason: 'held' };
  }

  const bitrate = input.availableOutgoingBitrate;
  if (bitrate === null || bitrate === undefined || !Number.isFinite(bitrate) || bitrate <= 0) {
    return { index: currentIndex, changed: false, reason: 'no-data' };
  }

  const withinCooldown =
    input.lastChangeAt != null && input.now - input.lastChangeAt < MIN_CHANGE_INTERVAL_MS;

  // One uplink carries every peer's copy of this stream: budget per sender.
  //
  // Why divide: the sample is the congestion controller's estimate for a single
  // ICE transport, and Chrome runs bandwidth estimation per PeerConnection — it
  // does NOT coordinate across them. N connections each believe they may send at
  // the full estimate while all competing for the same physical link, so the
  // usable per-stream budget is the estimate / N. Without the division, a 1.1
  // Mbps link looks like a comfortable 720p link to 8 peers while actually
  // asking for ~9.6 Mbps.
  const senderCount = Math.max(1, Math.floor(input.senderCount ?? 1));
  const kbps = bitrate / 1000 / senderCount;

  // Not enough headroom for what we are sending right now: step down.
  if (kbps < current.maxBitrateKbps * DEGRADE_HEADROOM) {
    if (withinCooldown) return { index: currentIndex, changed: false, reason: 'held' };
    const next = Math.min(currentIndex + 1, VIDEO_QUALITY_LADDER.length - 1);
    if (next === currentIndex) return { index: currentIndex, changed: false, reason: 'stable' };
    return { index: next, changed: true, reason: 'degraded' };
  }

  // Plenty of headroom for the next rung up: climb (but never past the cap).
  const betterIndex = currentIndex - 1;
  if (betterIndex >= bestAllowed) {
    const better = VIDEO_QUALITY_LADDER[betterIndex]!;
    if (kbps >= better.maxBitrateKbps * UPGRADE_HEADROOM) {
      if (withinCooldown) return { index: currentIndex, changed: false, reason: 'held' };
      return { index: betterIndex, changed: true, reason: 'upgraded' };
    }
  }

  return { index: currentIndex, changed: false, reason: 'stable' };
}

/**
 * One uplink serves every peer in a mesh, so the binding constraint is the
 * *worst* measured link, not the best or the average. Entries without a usable
 * measurement are ignored; if nothing is measurable the result is null.
 */
export function combineOutgoingBitrate(samples: Array<number | null | undefined>): number | null {
  const usable = samples.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (usable.length === 0) return null;
  return Math.min(...usable);
}
