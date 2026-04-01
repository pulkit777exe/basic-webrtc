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
  if (!stream) return;
  
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  
  // Log for debugging
  console.log('[RTCManager] attachLocalTracks:', {
    audioCount: audioTracks.length,
    videoCount: videoTracks.length,
    audioEnabled: audioTracks.map(t => t.enabled),
    videoEnabled: videoTracks.map(t => t.enabled),
  });
  
  audioTracks.forEach((track) => {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadySending) {
      console.log('[RTCManager] Adding audio track:', track.id, 'enabled:', track.enabled);
      connection.addTrack(track, stream);
    }
  });
  
  videoTracks.forEach((track) => {
    const alreadySending = connection.getSenders().some((sender) => sender.track?.id === track.id);
    if (!alreadySending) {
      console.log('[RTCManager] Adding video track:', track.id, 'enabled:', track.enabled);
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
    console.log(`[RTCManager] setLocalStream: ${stream ? 'stream set' : 'null'}, tracks=${stream?.getTracks().length ?? 0}`);
    peerConnections.forEach((connection, userId) => {
      console.log(`[RTCManager] setLocalStream: attaching to peer ${userId}`);
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
    console.log(`[RTCManager] createPeer: ${userId}, stream=${stream ? 'present' : 'null'}, tracks=${stream?.getTracks().length ?? 0}`);
    
    if (peerConnections.has(userId)) {
      const connection = peerConnections.get(userId)!;
      console.log(`[RTCManager] createPeer: reusing existing connection for ${userId}`);
      attachLocalTracks(connection, stream ?? localStream);
      return { connection, created: false };
    }
    const connection = new RTCPeerConnection({ iceServers });
    console.log(`[RTCManager] createPeer: created new connection for ${userId}`);
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
    peerConnections.forEach((connection, userId) => {
      console.log(`[RTCManager] replaceTrack for ${userId}: kind=${kind}, track=${track?.id ?? 'null'}, enabled=${track?.enabled}`);
      
      const transceivers = connection.getTransceivers();
      const transceiver = transceivers.find((t) => t.receiver?.track?.kind === kind || t.sender?.track?.kind === kind);
      // In cases where we have a transceiver that was created blindly from offerToReceive*, 
      // t.sender.track might be null, but t.receiver.track.kind is reliably what the m= line is typed as.
      
      if (!transceiver) {
        console.log(`[RTCManager] replaceTrack: no transceiver found for ${userId}, kind=${kind}`);
        // Fallback if not found by kind, we can rely on order: audio index 0, video index 1 usually.
        // But the best fallback is to just addTrack and trigger negotiation.
        if (track && localStream) {
          connection.addTrack(track, localStream);
        }
        return;
      }

      console.log(`[RTCManager] replaceTrack: found transceiver, direction=${transceiver.direction}, sender.track=${transceiver.sender.track?.id}`);
      
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
        // If track is null (muting), we still need to ensure the direction allows sending
        if (transceiver.direction !== 'sendrecv' && transceiver.direction !== 'sendonly') {
          try {
            transceiver.direction = 'sendrecv';
          } catch (err){
            console.error(err);
          }
        }
      }
    });
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
    const peers = new Map(store.get(peersAtom));
    const peer = peers.get(remoteUserId);
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
    peers.set(remoteUserId, { ...peer, stream: merged });
    store.set(peersAtom, peers);
  },

  /** Keep reference for addTrack fallback without re-attaching on every toggle */
  setLocalMediaStreamRef(stream: MediaStream | null) {
    localStream = stream;
  },
};
