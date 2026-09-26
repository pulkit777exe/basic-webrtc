/**
 * Simulcast send layers.
 *
 * This app is full mesh, so one camera is encoded and uploaded once per peer.
 * Simulcast turns that into one *upstream* encode with 3 representations the
 * far end can pick from, which is what makes a large mesh survivable: the
 * bandwidth estimate is per-transport and the receivers are competing for the
 * same uplink, so the local capture resolution cannot satisfy all of them at
 * once.
 *
 * Two things make this safe to ship:
 *
 * - **Capability detection.** Simulcast is only offered when the browser
 *   actually accepts `sendEncodings`. Safari and older Firefox throw or ignore
 *   it, and the caller falls back to a plain transceiver.
 * - **Lowest layer first.** A negotiated simulcast sender sends only the
 *   smallest layer until the application promotes one. Enabling simulcast
 *   *without* a layer policy would make every call worse, so the policy is
 *   derived from the same measured-bandwidth ladder that drives capture
 *   resolution, not from a guess.
 */

export interface SimulcastLayer {
  rid: string;
  /** Downscaling relative to the captured resolution (1 = full). */
  scaleResolutionDownBy: number;
  maxBitrateKbps: number;
}

/** Low to high. `q` is what a peer sends until the app promotes a layer. */
export const SIMULCAST_LAYERS: readonly SimulcastLayer[] = [
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrateKbps: 150 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrateKbps: 500 },
  { rid: 'f', scaleResolutionDownBy: 1, maxBitrateKbps: 1500 },
] as const;

/**
 * Whether this browser will negotiate simulcast.
 *
 * Probed on a throwaway connection rather than feature-sniffed, because support
 * shows up as `addTransceiver` accepting `sendEncodings` *and* the produced SDP
 * carrying `a=simulcast:send` — engines that ignore unknown dictionary members
 * only reveal themselves there. Aiming at a browser that quietly drops the
 * layers would leave every call sending the smallest layer forever, so both
 * halves have to hold.
 *
 * Cached as a promise: the probe costs a connection plus a round of SDP munging,
 * it cannot change for the life of the page, and concurrent callers must not
 * each build one.
 */
let cachedSupport: Promise<boolean> | null = null;

export function supportsSimulcast(): Promise<boolean> {
  cachedSupport ??= probeSimulcast();
  return cachedSupport;
}

/** Test seam: forgets the cached probe result. */
export function resetSimulcastSupportCache(): void {
  cachedSupport = null;
}

async function probeSimulcast(): Promise<boolean> {
  const Ctor = globalThis.RTCPeerConnection;
  if (typeof Ctor !== 'function') return false;
  let pc: RTCPeerConnection | null = null;
  try {
    pc = new Ctor({ iceServers: [] });
    const transceiver = pc.addTransceiver('video', {
      direction: 'sendonly',
      sendEncodings: SIMULCAST_LAYERS.map((layer) => ({ rid: layer.rid })),
    });
    const encodings = transceiver.sender.getParameters().encodings;
    // An engine that ignored sendEncodings still reports one encoding; that is
    // a "no", not a silent single-layer simulcast.
    if (!encodings || encodings.length !== SIMULCAST_LAYERS.length) return false;
    const offer = await pc.createOffer();
    return /a=simulcast:send/.test(offer.sdp ?? '');
  } catch {
    return false;
  } finally {
    try {
      pc?.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * `sendEncodings` for `addTransceiver`.
 *
 * No capture size is needed: `scaleResolutionDownBy` is relative to whatever the
 * track delivers, so the SDP is the same for a 360p and a 1080p camera and only
 * the encoder does the scaling. An earlier version capped each layer as a
 * fraction of the capture's pixel count, which disagreed with the capture
 * ladder's own bitrate for the same resolution and quietly throttled every
 * layer — the budget belongs to the ladder, not to a second estimate here.
 *
 * Each layer keeps its own cap, and `maxLayerForBudget` decides which of them
 * is worth sending at all; only one is ever active, so an inactive layer's cap
 * costs nothing.
 */
export function simulcastEncodings(): RTCRtpEncodingParameters[] {
  return SIMULCAST_LAYERS.map((layer, index) => ({
    rid: layer.rid,
    scaleResolutionDownBy: layer.scaleResolutionDownBy,
    maxBitrate: layer.maxBitrateKbps * 1000,
    // Lowest layer first: a negotiated simulcast sender sends its active
    // encoding and nothing else, so starting anywhere else is a promise the
    // link may not keep.
    active: index === 0,
  }));
}

/**
 * Promotion requires this multiple of the next layer's cap; demotion triggers
 * below `DEGRADE_HEADROOM` of the current one. The gap between them is the
 * hysteresis band — a link hovering at a threshold must not flap the layer,
 * which peers see as resolution stutter and the sender sees as wasted
 * `setParameters` churn. The values mirror the capture ladder in
 * `bandwidth.ts` so one policy's economics drive both.
 */
const UPGRADE_HEADROOM = 1.5;
const DEGRADE_HEADROOM = 0.9;

export interface LayerDecisionInput {
  /** Measured uplink per stream, in bits/sec. */
  availableOutgoingBitrate?: number | null;
  /**
   * Best layer this client may send, as an index into SIMULCAST_LAYERS
   * (higher = better). Derived from the capture ladder: there is no point
   * sending a 1080p layer from a 360p capture.
   */
  maxLayerIndex: number;
  currentLayerIndex: number;
}

export interface LayerDecision {
  /** Index into SIMULCAST_LAYERS. Higher is better; 0 is the safe default. */
  index: number;
  changed: boolean;
}

/**
 * Pick the simulcast layer to send.
 *
 * Indexes ascend with quality (0 = smallest), the *opposite* of the capture
 * ladder in `bandwidth.ts` where 0 is best. That inversion is a reliable source
 * of off-by-ones, so this module keeps its own direction and converts once, at
 * the call site, rather than making every reader remember which way is up.
 *
 * Unknown bandwidth is never a reason to promote: the lowest layer is the
 * correct default for a connection that has not been measured.
 */
export function chooseSimulcastLayer(input: LayerDecisionInput): LayerDecision {
  const top = SIMULCAST_LAYERS.length - 1;
  const best = Math.min(Math.max(input.maxLayerIndex, 0), top);
  // Clamp the *request*, not the result: pre-clamping `current` to `best` would
  // make the ceiling branch compare a value with itself and report no change,
  // so a demotion forced by a shrinking capture would never be applied.
  const current = Math.min(Math.max(input.currentLayerIndex, 0), top);

  // The capture can no longer supply the layer we were sending, whatever the
  // link looks like. A shrinking capture must be honoured even on a fast
  // connection, or we encode a layer nobody can render.
  if (current > best) return { index: best, changed: true };

  const bitrate = input.availableOutgoingBitrate;
  if (bitrate === null || bitrate === undefined || !Number.isFinite(bitrate) || bitrate <= 0) {
    return { index: current, changed: false };
  }
  const kbps = bitrate / 1000;

  if (kbps < SIMULCAST_LAYERS[current]!.maxBitrateKbps * DEGRADE_HEADROOM) {
    const next = Math.max(current - 1, 0);
    return { index: next, changed: next !== current };
  }

  const better = current + 1;
  if (better <= best && kbps >= SIMULCAST_LAYERS[better]!.maxBitrateKbps * UPGRADE_HEADROOM) {
    return { index: better, changed: true };
  }

  return { index: current, changed: false };
}

/**
 * Best layer an encoder budget can afford.
 *
 * Ties the layers to the capture ladder's own economics rather than to pixel
 * counts: a layer scaled to the full capture of a 360p source is still a
 * 360p stream, so asking for it spends encoder CPU and uplink for a resolution
 * nobody can see. The budget the capture ladder settled on is the honest
 * signal, and it is the same number the encoder cap is set from.
 *
 * Always returns at least the lowest layer — a budget too small even for that
 * is a broken measurement, not a reason to send nothing.
 */
export function maxLayerForBudget(kbps: number): number {
  if (!Number.isFinite(kbps) || kbps <= 0) return 0;
  let best = 0;
  for (let i = 0; i < SIMULCAST_LAYERS.length; i += 1) {
    const layer = SIMULCAST_LAYERS[i]!;
    if (layer.maxBitrateKbps <= kbps) best = i;
    else break;
  }
  return best;
}

/**
 * Apply a layer choice to a sender: exactly one encoding active, the rest
 * switched off, each capped at its bitrate. Returns false when the browser
 * refuses, so the caller can fall back rather than tear the connection down.
 */
export async function applySimulcastLayer(
  sender: RTCRtpSender,
  index: number,
): Promise<boolean> {
  if (!sender || sender.track?.kind !== 'video') return false;
  try {
    const parameters = sender.getParameters();
    const encodings = parameters.encodings;
    if (!encodings || encodings.length !== SIMULCAST_LAYERS.length) return false;

    const chosen = Math.min(Math.max(index, 0), encodings.length - 1);
    encodings.forEach((encoding, i) => {
      const layer = SIMULCAST_LAYERS[i];
      if (!layer) return;
      encoding.active = i === chosen;
      encoding.maxBitrate = layer.maxBitrateKbps * 1000;
    });
    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}
