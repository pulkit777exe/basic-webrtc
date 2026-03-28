import { api } from '@/lib/api';
import { store } from '@/store';
import { peersAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';

let iceServers: RTCIceServer[] = [];
const peerConnections = new Map<string, RTCPeerConnection>();
/** ICE candidates received before setRemoteDescription completes (trickle race). */
const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const iceRestartAttempts = new Map<string, number>();
const MAX_ICE_RESTARTS = 3;
let localStream: MediaStream | null = null;

function queueIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
  const q = pendingIceCandidates.get(userId) ?? [];
  q.push(candidate);
  pendingIceCandidates.set(userId, q);
}

async function flushPendingIceCandidates(userId: string) {
  const connection = peerConnections.get(userId);
  if (!connection?.remoteDescription) return;
  const queued = pendingIceCandidates.get(userId);
  if (!queued?.length) return;
  pendingIceCandidates.delete(userId);
  for (const c of queued) {
    await connection.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
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
  stream?.getTracks().forEach((track) => {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadySending) {
      connection.addTrack(track, stream);
    }
  });
}

export const RTCManager = {
  async init() {
    const res = await api.getIceServers();
    iceServers = res.iceServers ?? [];
  },

  setLocalStream(stream: MediaStream | null) {
    localStream = stream;
    peerConnections.forEach((connection) => attachLocalTracks(connection, stream));
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
      const peers = new Map(store.get(peersAtom));
      const peer = peers.get(userId);
      if (!peer) return;

      const track = event.track;
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

      peers.set(userId, {
        ...peer,
        stream: merged,
        video: hasLiveVideo || peer.video,
      });
      store.set(peersAtom, peers);
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
    
    // Prevent creating a new offer if we're already in the middle of negotiation
    // This prevents double-offer collisions when a peer reconnects
    const signalingState = connection.signalingState;
    if (signalingState !== 'stable') {
      console.warn(`[RTC] Skipping offer - signaling state is ${signalingState}`);
      return;
    }
    
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
    void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  },

  removePeer(userId: string) {
    pendingIceCandidates.delete(userId);
    const connection = peerConnections.get(userId);
    if (connection) {
      connection.close();
      peerConnections.delete(userId);
    }
    iceRestartAttempts.delete(userId);
    const peers = new Map(store.get(peersAtom));
    peers.delete(userId);
    store.set(peersAtom, peers);
  },

  disconnectAll() {
    for (const userId of [...peerConnections.keys()]) {
      this.removePeer(userId);
    }
  },

  replaceTrack(kind: 'audio' | 'video' | string, track: MediaStreamTrack | null) {
    peerConnections.forEach((connection) => {
      const sender = connection.getSenders().find((candidate) => candidate.track?.kind === kind);
      if (sender) {
        sender.replaceTrack(track).catch(() => {});
        return;
      }
      if (track && localStream) {
        connection.addTrack(track, localStream);
      }
    });
  },
};
