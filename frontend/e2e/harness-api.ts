/**
 * The harness's page API, declared once.
 *
 * `harness.ts` builds `window.__e2e`; the specs read it. Both need the same
 * types, and two `declare global` blocks for one property is a compile error
 * rather than a merge — so the contract lives here and both sides import it.
 */

export interface E2EStats {
  peers: number;
  connected: number;
  failed: number;
  bytesSent: number;
  bytesReceived: number;
  framesDecoded: number;
  candidatePairsSucceeded: number;
  /** Remote tracks as merged by the production ontrack handler into the store. */
  storeRemoteTracks: number;
  storeHasLiveVideo: boolean;
  signals: { joined: number; offer: number; answer: number; ice: number; peerLeft: number };
  error: string | null;
}

export interface SimulcastReport {
  /** The SDP actually negotiated simulcast, not just that we asked. */
  sdpSignalled: boolean;
  /** Encodings on the outgoing video sender, as the browser reports them. */
  encodings: Array<{ rid: string | null; active: boolean; maxBitrate: number | null }>;
  /**
   * Per-layer production, from `outbound-rtp`. The only observable proof of
   * which layer the engine is really sending, as opposed to which one was
   * requested — `getParameters` only echoes the last `setParameters` call.
   */
  layers: Array<{
    encodingIndex: number;
    rid: string | null;
    active: boolean;
    framesPerSecond: number;
    bytesSent: number;
  }>;
  /** The camera itself, from `media-source`. */
  source: { framesPerSecond: number; width: number; height: number } | null;
  /** Bitrate the browser last estimated for our outbound stream. */
  availableOutgoingBitrate: number | null;
}

export interface HarnessApi {
  peerId: string;
  roomId: string;
  stats: () => Promise<E2EStats>;
  simulcast: (peerId: string) => Promise<SimulcastReport | null>;
  /**
   * Run the production layer policy with this ceiling (best layer the encoder
   * budget allows), then report what the browser did with the result.
   */
  setSimulcastLayer: (ceiling: number) => Promise<SimulcastReport | null>;
  /**
   * Force a layer index, bypassing the bandwidth policy. For verifying that the
   * engine honours a layer switch, not which layer policy would pick.
   */
  forceSimulcastLayer: (peerId: string, index: number) => Promise<SimulcastReport | null>;
  stop: () => void;
}

declare global {
  interface Window {
    __e2e: HarnessApi;
  }
}
