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
  /**
   * The nominated, succeeded ICE pair, if one exists yet. The relay spec
   * asserts on this rather than on raw candidate counts: gathering a relay
   * candidate proves the TURN server answered Allocate, but only a nominated
   * relay pair proves media actually flows through it.
   */
  selectedPair: {
    localType: string | null;
    remoteType: string | null;
    relayProtocol: string | null;
  } | null;
  /** Remote tracks as merged by the production ontrack handler into the store. */
  storeRemoteTracks: number;
  storeHasLiveVideo: boolean;
  /**
   * The received video picture, from `inbound-rtp`. Resolution — not just
   * "video is live" — is the receiving-side proof of *which* simulcast layer
   * the far end is really sending: forcing layer f must widen this toward the
   * capture size, forcing q must shrink it. Null when nothing is received yet.
   */
  inboundVideo: { frameWidth: number; frameHeight: number; framesDecoded: number } | null;
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
  /**
   * One uplink estimate per peer connection, via the same production sampler
   * the adaptive controller reads. Null where a link has no estimate yet.
   * The bandwidth spec watches these collapse under a lossy relay.
   */
  bandwidth: () => Promise<Array<number | null>>;
  /**
   * Relay-mode report (SFU spec only): who this page sees over the relay and
   * whether their video is actually decoding frames. Absent in mesh mode.
   */
  sfuStats?: () => Promise<SfuStats | null>;
  stop: () => void;
}

/**
 * What one harness page observes over the SFU. `videoReadyState` is the
 * `<video>` element state for the peer's merged stream — `HAVE_CURRENT_DATA`
 * (2) or better means frames really decoded, not just that a track exists.
 */
export interface SfuStats {
  sfuConnected: boolean;
  peers: Array<{ userId: string; tracks: number; liveVideo: boolean; videoReadyState: number }>;
  /** Local tracks the relay session actually published — distinguishes a publish failure from a subscribe failure. */
  localPublications: string[];
  /** Remote participant identities the relay session currently sees. */
  remoteParticipants: string[];
  /** Per-publication subscription state from the relay's point of view. */
  remotePublications: Array<{
    participant: string;
    source: string;
    subscribed: boolean;
    hasTrack: boolean;
  }>;
  /** Subscriber PeerConnection state (null when the media path never got that far). */
  subscriberPcState: string | null;
  error: string | null;
}

declare global {
  interface Window {
    __e2e: HarnessApi;
  }
}
