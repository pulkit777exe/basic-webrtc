import { api } from '@/lib/api';
import { store } from '@/store';
import { peersAtom } from '@/store/atoms';
import { WSManager } from '@/lib/ws-manager';

let iceServers: RTCIceServer[] = [];
const peerConnections = new Map<string, RTCPeerConnection>();

export const RTCManager = {
  async init() {
    const res = await api.getIceServers();
    iceServers = res.iceServers ?? [];
  },

  async createPeer(userId: string, stream: MediaStream | null) {
    const pc = new RTCPeerConnection({ iceServers });

    stream?.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (e) => {
      const peers = new Map(store.get(peersAtom));
      const p = peers.get(userId);
      if (p && e.streams[0]) {
        peers.set(userId, { ...p, stream: e.streams[0] });
        store.set(peersAtom, peers);
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) WSManager.send({ type: 'ice', to: userId, candidate: e.candidate.toJSON() });
    };

    peerConnections.set(userId, pc);
    return pc;
  },

  async offer(userId: string) {
    const pc = peerConnections.get(userId);
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    WSManager.send({ type: 'offer', to: userId, sdp: offer });
  },

  async setRemoteDescription(userId: string, sdp: RTCSessionDescriptionInit) {
    const pc = peerConnections.get(userId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  },

  async answer(userId: string) {
    const pc = peerConnections.get(userId);
    if (!pc) return;
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    WSManager.send({ type: 'answer', to: userId, sdp: answer });
  },

  addIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
    const pc = peerConnections.get(userId);
    if (!pc) return;
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  },

  removePeer(userId: string) {
    const pc = peerConnections.get(userId);
    if (pc) {
      pc.close();
      peerConnections.delete(userId);
    }
    const peers = new Map(store.get(peersAtom));
    peers.delete(userId);
    store.set(peersAtom, peers);
  },

  replaceTrack(kind: string, track: MediaStreamTrack | null) {
    peerConnections.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) sender.replaceTrack(track);
    });
  },
};
