import { api } from '@/lib/api';
import { store } from '@/store';
import { peerAtomFamily, peerIdsAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';
import { PendingIceQueue } from '@/lib/pending-ice';
import { extractAvailableOutgoingBitrate } from '@/lib/webrtc-stats';
import {
  SIMULCAST_LAYERS,
  applySimulcastLayer,
  chooseSimulcastLayer,
  simulcastEncodings,
  supportsSimulcast,
} from '@/lib/simulcast';

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const BUNDLE_POLICIES = ['balanced', 'max-compat', 'max-bundle'] as const;
// Browsers only accept "require" — "negotiate" was removed from the WebRTC
// spec — so an env value of "negotiate" is dropped and the default applies.
const RTCP_MUX_POLICIES = ['require'] as const;
const MAX_ICE_CANDIDATE_POOL_SIZE = 25;
/** From GET /api/ice-servers, whitelisted — see buildIceConfiguration. */
let peerConfiguration: RTCConfiguration = { iceServers: FALLBACK_ICE_SERVERS };
const peerConnections = new Map<string, RTCPeerConnection>();
/** ICE candidates received before setRemoteDescription completes (trickle race). */
const pendingIce = new PendingIceQueue({
  onTimeout: (userId) => console.warn(`[RTCManager] ICE queue timeout for peer ${userId}`),
});
const iceRestartAttempts = new Map<string, number>();
const seenTrackIds = new Map<string, Set<string>>();
/** Screen share MediaStreams per remote peer. */
const screenStreams = new Map<string, MediaStream>();
/** Local screen share senders per remote peer. */
const screenSenders = new Map<string, RTCRtpSender>();
/**
 * Active simulcast layer per sender, keyed weakly so a closed connection's
 * sender is collected with it. Starts absent, which reads as layer 0 — the
 * lowest — matching what the transceiver was created with.
 */
const simulcastLayers = new WeakMap<RTCRtpSender, number>();
const MAX_ICE_RESTARTS = 3;
let localStream: MediaStream | null = null;

function queueIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
  pendingIce.push(userId, candidate);
}

/**
 * Salvage a camera that `setRemoteDescription` refused to bind.
 *
 * `sendEncodings` is an offer-side property: when a connection that already
 * holds a simulcast video transceiver processes a *remote* description, Chrome
 * does not reuse that transceiver for the peer's video m-line. It creates a
 * separate one instead, leaving our camera on a transceiver that never gets a
 * `mid` (`currentDirection` stays null) and so never reaches the peer.
 *
 * Verified in real browsers rather than assumed — see
 * `frontend/e2e/specs/simulcast.spec.ts`, which saw no video at all before this
 * existed.
 *
 * So the answerer moves its camera onto the m-line that *was* negotiated and
 * gives up the layers for that link. Degrading to single-layer video is
 * correct; degrading to no video is not. Must run after `setRemoteDescription`
 * and before `createAnswer`, so the answer carries the restored `sendrecv`.
 */
async function reconcileVideoSenders(connection: RTCPeerConnection): Promise<void> {
  const transceivers = connection.getTransceivers();
  // A sender that never got a direction is one no m-line was matched to.
  const stranded = transceivers.find(
    (t) => t.sender.track?.kind === 'video' && t.currentDirection === null,
  );
  if (!stranded) return;

  // The transceiver the remote description created for the peer's video m-line.
  // `mid` is the reliable marker here, not `currentDirection`: on the answerer
  // the direction is not settled until the answer is applied, so a freshly
  // matched transceiver still reports null.
  const target = transceivers.find(
    (t) =>
      t !== stranded &&
      t.receiver.track?.kind === 'video' &&
      !t.sender.track &&
      (t.mid !== null || t.currentDirection !== null),
  );
  if (!target) return;

  const track = stranded.sender.track;
  try {
    await target.sender.replaceTrack(track);
    target.direction = 'sendrecv';
    // Retire the unused transceiver so it cannot claim a sender slot, inflate
    // getVideoSenderCount, or add a stray m-line to the answer.
    stranded.stop();
    console.warn(
      '[RTCManager] peer did not accept simulcast layers on this link; sending single-layer video',
    );
  } catch (error) {
    console.warn('[RTCManager] could not move camera onto the negotiated m-line', error);
  }
}

async function flushPendingIceCandidates(userId: string) {
  const connection = peerConnections.get(userId);
  if (!connection?.remoteDescription) return;
  const queued = pendingIce.take(userId);
  for (const c of queued) {
    await connection.addIceCandidate(new RTCIceCandidate(c)).catch((e) => {
      console.warn(`[RTCManager] addIceCandidate failed for ${userId}:`, e);
    });
  }
}

async function restartIceConnection(userId: string) {
  const connection = peerConnections.get(userId);
  if (!connection) return;
  // Don't burn a restart attempt (or gather candidates we cannot deliver) while
  // signaling is down: the offer would be prepared and then dropped on the
  // floor, and the attempt budget would be gone before signaling returns.
  if (!WSManager.isConnected()) return;
  const attempts = iceRestartAttempts.get(userId) ?? 0;
  if (attempts >= MAX_ICE_RESTARTS) return;
  iceRestartAttempts.set(userId, attempts + 1);
  // Drop stale candidates *and* the queue's timer, so the old TTL cannot fire
  // against a batch queued after this point.
  pendingIce.clear(userId);

  try {
    connection.restartIce();
    const offer = await connection.createOffer({
      iceRestart: true,
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await connection.setLocalDescription(offer);
    if (!WSManager.send({ type: 'offer', to: userId, sdp: offer })) {
      // Signaling dropped between the check and the send. Give the attempt
      // back so a later ICE failure (or the next refresh) can retry.
      iceRestartAttempts.set(userId, attempts);
    }
  } catch {
    // ICE restart can fail during transient negotiation races.
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Build the RTCPeerConnection configuration from GET /api/ice-servers. The
 * server also returns env-tuned ICE hints (bundlePolicy, rtcpMuxPolicy,
 * iceCandidatePoolSize); each is whitelisted/clamped here because the
 * RTCPeerConnection constructor *throws* on invalid enum strings — one bad
 * env value would otherwise take down every peer connection in the room.
 */
export function buildIceConfiguration(res: {
  iceServers?: RTCIceServer[];
  config?: {
    iceCandidatePoolSize?: number;
    bundlePolicy?: string;
    rtcpMuxPolicy?: string;
  };
}): RTCConfiguration {
  const configuration: RTCConfiguration = {
    iceServers: res.iceServers?.length ? res.iceServers : FALLBACK_ICE_SERVERS,
  };
  const config = res.config;
  if (!config) return configuration;
  if (isOneOf(config.bundlePolicy, BUNDLE_POLICIES)) {
    configuration.bundlePolicy = config.bundlePolicy;
  }
  if (isOneOf(config.rtcpMuxPolicy, RTCP_MUX_POLICIES)) {
    configuration.rtcpMuxPolicy = config.rtcpMuxPolicy;
  }
  if (
    typeof config.iceCandidatePoolSize === 'number' &&
    Number.isFinite(config.iceCandidatePoolSize)
  ) {
    configuration.iceCandidatePoolSize = Math.min(
      MAX_ICE_CANDIDATE_POOL_SIZE,
      Math.max(0, Math.floor(config.iceCandidatePoolSize)),
    );
  }
  return configuration;
}

/** Mirror a peer's RTCPeerConnection.connectionState into its atom (tile chip). */
function publishConnState(userId: string, state: RTCPeerConnectionState): void {
  const peer = store.get(peerAtomFamily(userId));
  if (!peer || peer.connState === state) return;
  store.set(peerAtomFamily(userId), { ...peer, connState: state });
}

/**
 * Attach the local stream, using a simulcast transceiver for the first video
 * track when the browser supports it.
 *
 * Simulcast has to be requested at transceiver creation: `addTrack` cannot carry
 * `sendEncodings`, so the layers only exist if this path runs for the first
 * video track. Later tracks (a screen share arriving mid-call) are added
 * plainly — a connection's encoding count is fixed at negotiation, and asking a
 * negotiated sender for more layers is a `setParameters` error, not a feature.
 */
async function attachLocalTracks(connection: RTCPeerConnection, stream: MediaStream | null) {
  if (!stream) return;

  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();

  audioTracks.forEach((track) => {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadySending) {
      connection.addTrack(track, stream);
    }
  });

  // Only the first video track gets the layers. Encoding count is fixed at
  // negotiation, so a screen share joining mid-call has to be a plain sender.
  let hasVideoSender = connection.getSenders().some((sender) => sender.track?.kind === 'video');

  for (const track of videoTracks) {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (alreadySending) continue;

    if (hasVideoSender || !(await supportsSimulcast())) {
      connection.addTrack(track, stream);
      hasVideoSender = true;
      continue;
    }

    try {
      connection.addTransceiver(track, {
        direction: 'sendrecv',
        streams: [stream],
        sendEncodings: simulcastEncodings(),
      });
      hasVideoSender = true;
    } catch (error) {
      // A transceiver that will not take the layers is not a reason to drop the
      // camera: fall back to a plain sender for this connection.
      console.warn('[RTCManager] simulcast transceiver rejected, using addTrack', error);
      connection.addTrack(track, stream);
      hasVideoSender = true;
    }
  }
}

/**
 * Serialize track attachment per connection.
 *
 * `attachLocalTracks` awaits the simulcast capability probe, so two attaches to
 * the same connection can interleave: both would see the track as not yet
 * sending and add it, leaving the peer with two video senders for one camera.
 * Chaining them keeps the "already sending?" check meaningful. A failed attach
 * is swallowed so one bad connection cannot poison every later attach to it.
 */
const attachChains = new WeakMap<RTCPeerConnection, Promise<void>>();

function queueAttachTracks(connection: RTCPeerConnection, stream: MediaStream | null): Promise<void> {
  const next = (attachChains.get(connection) ?? Promise.resolve())
    .catch(() => {})
    .then(() => attachLocalTracks(connection, stream));
  attachChains.set(connection, next);
  return next;
}

export const RTCManager = {
  async init() {
    try {
      peerConfiguration = buildIceConfiguration(await api.getIceServers());
    } catch {
      peerConfiguration = { iceServers: FALLBACK_ICE_SERVERS };
    }
  },

  /**
   * Re-fetch ICE/TURN credentials and apply them to live peer connections.
   *
   * TURN credentials are HMAC-signed with a short TTL (TURN_TTL_SEC, 5 min by
   * default), so credentials obtained at join time stop being accepted partway
   * through a call — and a network change (WiFi → cellular) invalidates them
   * immediately. `setConfiguration` is the only way to change the servers of an
   * existing connection, and it needs a fresh ICE restart to gather new
   * candidates under the new credentials.
   *
   * Returns true when the configuration was replaced.
   */
  async refreshIceConfiguration(): Promise<boolean> {
    let next: RTCConfiguration;
    try {
      next = buildIceConfiguration(await api.getIceServers());
    } catch (error) {
      console.warn('[RTCManager] ICE refresh failed, keeping current servers', error);
      return false;
    }

    peerConfiguration = next;
    let changed = false;
    for (const [userId, connection] of peerConnections) {
      try {
        connection.setConfiguration(next);
        changed = true;
        void restartIceConnection(userId);
      } catch (error) {
        console.warn(`[RTCManager] setConfiguration failed for ${userId}`, error);
      }
    }
    return changed;
  },

  /**
   * Cap the encoder bitrate on every outgoing video sender.
   *
   * Capture resolution bounds how many pixels the encoder has to work with; this
   * bounds the encoded stream itself, which is what congestion control actually
   * reacts to. The two complement each other in a mesh, where the same local
   * stream is encoded and uploaded once per peer.
   *
   * Applied as a per-sender `setParameters` call and never fatal: a sender that
   * rejects the new parameters (closing connection, browser quirk) keeps its
   * current value.
   */
  async setVideoMaxBitrate(bitsPerSecond: number): Promise<void> {
    const senders = [...peerConnections.values()].flatMap((connection) =>
      connection
        .getSenders()
        .filter((sender) => sender.track?.kind === 'video')
        .map((sender) => ({ connection, sender })),
    );

    await Promise.all(
      senders.map(async ({ connection, sender }) => {
        if (connection.connectionState === 'closed') return;
        try {
          const parameters = sender.getParameters();
          if (!parameters.encodings || parameters.encodings.length === 0) {
            parameters.encodings = [{}];
          }
          for (const encoding of parameters.encodings) {
            encoding.maxBitrate = bitsPerSecond;
          }
          await sender.setParameters(parameters);
        } catch (error) {
          console.warn('[RTCManager] setVideoMaxBitrate failed', error);
        }
      }),
    );
  },

  /**
   * Choose and apply a simulcast layer on every layered video sender.
   *
   * A negotiated simulcast sender transmits *only* its active encoding until
   * the application promotes one, so this is not an optimisation — without it
   * every call runs at the smallest layer regardless of the link. The layer is
   * decided per connection from that connection's own uplink estimate, because
   * in a mesh one peer can be on wifi and the next on a wired link, and a
   * single global layer would strand the good one and overload the bad one.
   *
   * Non-layered senders (a browser without simulcast, or a screen share added
   * after negotiation) are left alone rather than half-configured.
   *
   * `maxLayerIndex` is the ceiling implied by the encoder budget the capture
   * ladder settled on; pass the top index when no ceiling is known.
   */
  async updateSimulcastLayers(maxLayerIndex: number): Promise<void> {
    const layered = [...peerConnections.values()].flatMap((connection) =>
      connection
        .getSenders()
        .filter(
          (sender) =>
            sender.track?.kind === 'video' &&
            (sender.getParameters().encodings?.length ?? 0) === SIMULCAST_LAYERS.length,
        )
        .map((sender) => ({ connection, sender })),
    );
    if (layered.length === 0) return;

    const applied = new Set<RTCRtpSender>();

    await Promise.all(
      layered.map(async ({ connection, sender }) => {
        if (applied.has(sender)) return;
        applied.add(sender);
        if (connection.connectionState === 'closed') return;

        // No estimate is not a reason to promote: chooseSimulcastLayer holds
        // the current layer when the measurement is missing.
        const bitrate = await connection
          .getStats()
          .then((report) => extractAvailableOutgoingBitrate(report))
          .catch(() => null);

        const decision = chooseSimulcastLayer({
          availableOutgoingBitrate: bitrate,
          maxLayerIndex,
          // Per sender, not global: two peers can be promoted independently.
          currentLayerIndex: simulcastLayers.get(sender) ?? 0,
        });
        if (!decision.changed) return;
        if (await applySimulcastLayer(sender, decision.index)) {
          simulcastLayers.set(sender, decision.index);
        }
      }),
    );
  },

  /**
   * How many peers the local camera is currently being sent to. The adaptive
   * quality budget divides the uplink by this, since every peer gets its own
   * copy of the same stream.
   */
  getVideoSenderCount(): number {
    let count = 0;
    for (const connection of peerConnections.values()) {
      for (const sender of connection.getSenders()) {
        if (sender.track?.kind === 'video') count += 1;
      }
    }
    return count;
  },

  /**
   * One uplink estimate per peer connection, for adaptive quality. Entries are
   * null where a link has not produced an estimate yet (or the connection is
   * closing) — the caller reduces these to the binding constraint.
   */
  async sampleOutgoingBitrate(): Promise<Array<number | null>> {
    return Promise.all(
      [...peerConnections.values()].map(async (connection) => {
        try {
          const report = await connection.getStats();
          return extractAvailableOutgoingBitrate(report);
        } catch {
          return null;
        }
      }),
    );
  },

  /**
   * Publish the local stream to every open connection.
   *
   * Fire-and-forget: callers set the stream and then wait for signaling, and an
   * attachment that lands after the connection is established renegotiates by
   * itself. A track that cannot be attached at all is not worth failing the
   * caller's setup over — the per-connection chain logs it.
   */
  setLocalStream(stream: MediaStream | null) {
    localStream = stream;
    peerConnections.forEach((connection) => {
      void queueAttachTracks(connection, stream).catch((error) => {
        console.warn('[RTCManager] attaching local tracks failed', error);
      });
    });
  },

  /**
   * Creates or reuses a peer connection. `created` is true only for a new PC so callers
   * can avoid sending a fresh offer when the peer already exists (reconnect / duplicate join).
   */
  async createPeer(
    userId: string,
    stream: MediaStream | null,
  ): Promise<{ connection: RTCPeerConnection; created: boolean }> {
    if (peerConnections.has(userId)) {
      const connection = peerConnections.get(userId)!;
      await queueAttachTracks(connection, stream ?? localStream);
      return { connection, created: false };
    }
    const connection = new RTCPeerConnection(peerConfiguration);
    // Awaited: the caller offers immediately on a new connection, and an offer
    // sent before the tracks are attached would need a second round trip.
    await queueAttachTracks(connection, stream ?? localStream);

    connection.ontrack = (event) => {
      const peer = store.get(peerAtomFamily(userId));
      if (!peer) return;

      const track = event.track;
      // Robust dedup: Safari can fire ontrack multiple times for the same track
      let peerSeen = seenTrackIds.get(userId);
      if (!peerSeen) {
        peerSeen = new Set();
        seenTrackIds.set(userId, peerSeen);
      }
      if (peerSeen.has(track.id)) return;
      peerSeen.add(track.id);

      // Use the peer's screen flag (set via media-state signaling) to distinguish
      // camera from screen share. This survives renegotiation / ICE restarts unlike
      // a track counter which would misclassify new camera tracks.
      if (track.kind === 'video' && peer.screen) {
        let ss = screenStreams.get(userId);
        if (!ss) {
          ss = new MediaStream();
          screenStreams.set(userId, ss);
        }
        if (!ss.getTracks().some((t) => t.id === track.id)) {
          ss.addTrack(track);
        }
        store.set(peerAtomFamily(userId), {
          ...peer,
          screenStream: ss,
        });
        return;
      }

      // Camera / audio track — merge into peer.stream as before
      const incoming = event.streams[0];
      let merged = peer.stream ?? null;

      if (!merged) {
        merged = incoming ?? new MediaStream([track]);
      } else if (incoming && incoming.id !== merged.id) {
        incoming.getTracks().forEach((t) => {
          if (!merged!.getTracks().some((x) => x.id === t.id)) {
            try {
              merged!.addTrack(t);
            } catch {
              // Track may already be bound to another stream in some browsers.
            }
          }
        });
      }
      if (!merged.getTracks().some((t) => t.id === track.id)) {
        try {
          merged.addTrack(track);
        } catch {
          merged = new MediaStream([...merged.getTracks(), track]);
        }
      }

      const hasLiveVideo = merged
        .getVideoTracks()
        .some((t) => t.readyState === 'live' && t.enabled);

      store.set(peerAtomFamily(userId), {
        ...peer,
        stream: merged,
        video: hasLiveVideo || peer.video,
      });
    };

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        WSManager.send({ type: 'ice', to: userId, candidate: event.candidate.toJSON() });
      }
    };

    connection.oniceconnectionstatechange = () => {
      const state = connection.iceConnectionState;
      if (state === 'failed') {
        void restartIceConnection(userId);
      }
      if (state === 'connected' || state === 'completed') {
        iceRestartAttempts.set(userId, 0);
      }
    };

    connection.onconnectionstatechange = () => {
      publishConnState(userId, connection.connectionState);
      if (connection.connectionState === 'failed') {
        void restartIceConnection(userId);
      }
    };

    connection.onnegotiationneeded = () => {
      void (async () => {
        try {
          if (!connection.remoteDescription || connection.signalingState !== 'stable') {
            return;
          }
          const offer = await connection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await connection.setLocalDescription(offer);
          WSManager.send({ type: 'offer', to: userId, sdp: offer });
        } catch {
          // Ignore races with simultaneous negotiation (e.g. both ends re-offering).
        }
      })();
    };

    peerConnections.set(userId, connection);
    publishConnState(userId, connection.connectionState);
    return { connection, created: true };
  },

  async offer(userId: string) {
    const connection = peerConnections.get(userId);
    if (!connection) return;
    
    const signalingState = connection.signalingState;
    if (signalingState !== 'stable') return;
    
    const offer = await connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await connection.setLocalDescription(offer);
    WSManager.send({ type: 'offer', to: userId, sdp: offer });
  },

  async setRemoteDescription(userId: string, sdp: RTCSessionDescriptionInit) {
    const connection = peerConnections.get(userId);
    if (!connection) return;
    await connection.setRemoteDescription(new RTCSessionDescription(sdp));
    // Before the ICE flush and before any answer is built, so a camera left
    // stranded by the remote m-line matching is recovered in the same turn.
    await reconcileVideoSenders(connection);
    await flushPendingIceCandidates(userId);
  },

  async answer(userId: string) {
    const connection = peerConnections.get(userId);
    if (!connection) return;
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    WSManager.send({ type: 'answer', to: userId, sdp: answer });
  },

  addIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
    const connection = peerConnections.get(userId);
    if (!connection) {
      queueIceCandidate(userId, candidate);
      return;
    }
    if (!connection.remoteDescription) {
      queueIceCandidate(userId, candidate);
      return;
    }
    void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch((e) => {
      console.warn(`[RTCManager] addIceCandidate failed for ${userId}:`, e);
    });
  },

  removePeer(userId: string) {
    pendingIce.clear(userId);
    seenTrackIds.delete(userId);
    const ss = screenStreams.get(userId);
    if (ss) {
      ss.getTracks().forEach((t) => t.stop());
      screenStreams.delete(userId);
    }
    screenSenders.delete(userId);
    const connection = peerConnections.get(userId);
    if (connection) {
      connection.close();
      peerConnections.delete(userId);
    }
    iceRestartAttempts.delete(userId);
    store.set(peerAtomFamily(userId), null);
    store.set(peerIdsAtom, (prev) => prev.filter((id) => id !== userId));
  },

  disconnectAll() {
    // Peers can have queued ICE candidates without a live connection (candidates
    // that arrived before their offer), so sweep both sets — otherwise their
    // queues and TTL timers outlive the call.
    const userIds = new Set([...peerConnections.keys(), ...pendingIce.peers]);
    for (const userId of userIds) {
      this.removePeer(userId);
    }
  },

  replaceTrack(kind: 'audio' | 'video' | string, track: MediaStreamTrack | null) {
    peerConnections.forEach((connection) => {
      const transceivers = connection.getTransceivers();
      const transceiver = transceivers.find((t) => t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind);
      
      if (!transceiver) {
        if (track && localStream) {
          connection.addTrack(track, localStream);
        }
        return;
      }

      if (track) {
        transceiver.sender.replaceTrack(track).catch(() => {});
        
        if (transceiver.direction !== 'sendrecv' && transceiver.direction !== 'sendonly') {
          try {
            // This will trigger onnegotiationneeded
            transceiver.direction = 'sendrecv';
          } catch {
            // Some browsers complain if changing direction, but usually it works
          }
        }
      } else {
        if (transceiver.direction !== 'sendrecv' && transceiver.direction !== 'sendonly') {
          try {
            transceiver.direction = 'sendrecv';
          } catch {
            // Some browsers complain if changing direction, but usually it works
          }
        }
      }
    });
  },

  /**
   * Add a screen share track to all peer connections (separate transceiver).
   * This does NOT replace the camera — both camera and screen are sent simultaneously.
   */
  addScreenTrack(track: MediaStreamTrack, stream: MediaStream) {
    peerConnections.forEach((connection, userId) => {
      const sender = connection.addTrack(track, stream);
      screenSenders.set(userId, sender);
    });
  },

  /**
   * Remove screen share track from all peer connections and renegotiate.
   */
  removeScreenTrack() {
    peerConnections.forEach((connection, userId) => {
      const sender = screenSenders.get(userId);
      if (sender) {
        connection.removeTrack(sender);
        screenSenders.delete(userId);
      }
    });
    // Clear remote screen streams
    screenStreams.forEach((ss, userId) => {
      ss.getTracks().forEach((t) => t.stop());
      const peer = store.get(peerAtomFamily(userId));
      if (peer) {
        store.set(peerAtomFamily(userId), { ...peer, screenStream: null });
      }
    });
    screenStreams.clear();
  },

  /** Rebuild remote MediaStream from RTP receivers (replaceTrack does not fire ontrack). */
  syncIncomingMedia(remoteUserId: string) {
    const connection = peerConnections.get(remoteUserId);
    if (!connection) return;
    const tracks = connection
      .getReceivers()
      .map((r) => r.track)
      .filter(
        (t): t is MediaStreamTrack =>
          t != null && t.readyState !== 'ended',
      );
    const peer = store.get(peerAtomFamily(remoteUserId));
    if (!peer) return;
    const merged = new MediaStream();
    const seen = new Set<string>();
    for (const t of tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      try {
        merged.addTrack(t);
      } catch {
        /* duplicate */
      }
    }
    store.set(peerAtomFamily(remoteUserId), { ...peer, stream: merged });
  },

  /** Keep reference for addTrack fallback without re-attaching on every toggle */
  setLocalMediaStreamRef(stream: MediaStream | null) {
    localStream = stream;
  },
};
