import { api } from '@/lib/api';
import { store } from '@/store';
import { peersAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';

let iceServers: RTCIceServer[] = [];
const peerConnections = new Map<string, RTCPeerConnection>();
const iceRestartAttempts = new Map<string, number>();
const MAX_ICE_RESTARTS = 3;
let localStream: MediaStream | null = null;

async function restartIceConnection(userId: string) {
  const connection = peerConnections.get(userId);
  if (!connection) return;
  const attempts = iceRestartAttempts.get(userId) ?? 0;
  if (attempts >= MAX_ICE_RESTARTS) return;
  iceRestartAttempts.set(userId, attempts + 1);

  try {
    connection.restartIce();
    const offer = await connection.createOffer({ iceRestart: true });
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

  async createPeer(userId: string, stream: MediaStream | null) {
    // Prevent duplicate peer connections - return early if already exists
    if (peerConnections.has(userId)) {
      return peerConnections.get(userId)!;
    }
    const connection = new RTCPeerConnection({ iceServers });
    attachLocalTracks(connection, stream ?? localStream);

    connection.ontrack = (event) => {
      const peers = new Map(store.get(peersAtom));
      const peer = peers.get(userId);
      if (peer && event.streams[0]) {
        peers.set(userId, { ...peer, stream: event.streams[0] });
        store.set(peersAtom, peers);
      }
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

    peerConnections.set(userId, connection);
    return connection;
  },

  async offer(userId: string) {
    const connection = peerConnections.get(userId);
    if (!connection) return;
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    WSManager.send({ type: 'offer', to: userId, sdp: offer });
  },

  async setRemoteDescription(userId: string, sdp: RTCSessionDescriptionInit) {
    const connection = peerConnections.get(userId);
    if (!connection) return;
    await connection.setRemoteDescription(new RTCSessionDescription(sdp));
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
    if (!connection) return;
    connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  },

  removePeer(userId: string) {
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
