import { api } from '@/lib/api';
import { store } from '@/store';
import { peerAtomFamily, peerIdsAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';

let iceServers: RTCIceServer[] = [];
const peerConnections = new Map<string, RTCPeerConnection>();
/** ICE candidates received before setRemoteDescription completes (trickle race). */
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const pendingIceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const iceRestartAttempts = new Map<string, number>();
const seenTrackIds = new Map<string, Set<string>>();
/** Screen share MediaStreams per remote peer. */
const screenStreams = new Map<string, MediaStream>();
/** Local screen share senders per remote peer. */
const screenSenders = new Map<string, RTCRtpSender>();
const MAX_ICE_RESTARTS = 3;
const MAX_PENDING_ICE = 50;
const PENDING_ICE_TTL_MS = 30000;
let localStream: MediaStream | null = null;

function queueIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
  let q = pendingIceCandidates.get(userId);
  if (!q) {
    q = [];
    pendingIceCandidates.set(userId, q);
    // Set TTL timer
    const timer = setTimeout(() => {
      console.warn(`[RTCManager] ICE queue timeout for peer ${userId}`);
      pendingIceCandidates.delete(userId);
      pendingIceTimers.delete(userId);
    }, PENDING_ICE_TTL_MS);
    pendingIceTimers.set(userId, timer);
  }
  if (q.length >= MAX_PENDING_ICE) {
    q.shift(); // Drop oldest on overflow
  }
  q.push(candidate);
}

async function flushPendingIceCandidates(userId: string) {
  const connection = peerConnections.get(userId);
  if (!connection?.remoteDescription) return;
  const queued = pendingIceCandidates.get(userId);
  if (!queued?.length) return;
  pendingIceCandidates.delete(userId);
  const timer = pendingIceTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    pendingIceTimers.delete(userId);
  }
  for (const c of queued) {
    await connection.addIceCandidate(new RTCIceCandidate(c)).catch((e) => {
      console.warn(`[RTCManager] addIceCandidate failed for ${userId}:`, e);
    });
  }
}

async function restartIceConnection(userId: string) {
  const connection = peerConnections.get(userId);
  if (!connection) return;
  const attempts = iceRestartAttempts.get(userId) ?? 0;
  if (attempts >= MAX_ICE_RESTARTS) return;
  iceRestartAttempts.set(userId, attempts + 1);
  pendingIceCandidates.delete(userId);

  try {
    connection.restartIce();
    const offer = await connection.createOffer({
      iceRestart: true,
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await connection.setLocalDescription(offer);
    WSManager.send({ type: 'offer', to: userId, sdp: offer });
  } catch {
    // ICE restart can fail during transient negotiation races.
  }
}

function attachLocalTracks(connection: RTCPeerConnection, stream: MediaStream | null) {
  if (!stream) return;
  
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  
  audioTracks.forEach((track) => {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadySending) {
      connection.addTrack(track, stream);
    }
  });
  
  videoTracks.forEach((track) => {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadySending) {
      connection.addTrack(track, stream);
    }
  });
}

export const RTCManager = {
  async init() {
    try {
      const res = await api.getIceServers();
      iceServers = res.iceServers && res.iceServers.length > 0 ? res.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
    } catch {
      iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
  },

  setLocalStream(stream: MediaStream | null) {
    localStream = stream;
    peerConnections.forEach((connection, userId) => {
      attachLocalTracks(connection, stream);
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
      attachLocalTracks(connection, stream ?? localStream);
      return { connection, created: false };
    }
    const connection = new RTCPeerConnection({ iceServers });
    attachLocalTracks(connection, stream ?? localStream);

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
    pendingIceCandidates.delete(userId);
    const timer = pendingIceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      pendingIceTimers.delete(userId);
    }
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
    for (const userId of [...peerConnections.keys()]) {
      this.removePeer(userId);
    }
  },

  replaceTrack(kind: 'audio' | 'video' | string, track: MediaStreamTrack | null) {
    peerConnections.forEach((connection, userId) => {
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
