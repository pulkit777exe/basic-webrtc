/**
 * Two-browser WebRTC harness.
 *
 * Drives the *production* peer module — `RTCManager` — in a real Chromium with
 * real media devices: real `RTCPeerConnection`s, real SDP, real ICE, real
 * encoders, and the production `ontrack` merge that writes the remote stream
 * into the real jotai store. The signaling transport is a stub relay, because
 * what this rig exists to cover is the browser stack that jsdom cannot reach.
 *
 * The offer/answer/ICE exchange mirrors the app's rule: the peer with the
 * lexicographically greater id offers, candidates trickle, and
 * `RTCManager.setRemoteDescription` is used (not a raw call) because it is what
 * flushes the pending-ICE queue.
 *
 *   ?peerId=alpha&roomId=e2e&ws=ws://127.0.0.1:8787
 *
 * `window.__e2e` is the test's handle on the page.
 */
import { RTCManager } from '../src/lib/rtc-manager';
import { store } from '../src/store';
import { peerAtomFamily, peerIdsAtom } from '../src/store/atoms';

const params = new URLSearchParams(location.search);
const PEER_ID = params.get('peerId') ?? 'alpha';
const ROOM_ID = params.get('roomId') ?? 'e2e';
const WS_URL = params.get('ws') ?? 'ws://127.0.0.1:8787';

type Signal = { type: string; peerId?: string; from?: string; [key: string]: unknown };

const connections = new Map<string, RTCPeerConnection>();
const signals = { joined: 0, offer: 0, answer: 0, ice: 0, peerLeft: 0 };
let socket: WebSocket | null = null;
let localStream: MediaStream | null = null;
let failure: string | null = null;

function send(payload: Signal): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

/** Only the greater id offers, so both sides never offer at once. */
function shouldOffer(otherId: string): boolean {
  return PEER_ID > otherId;
}

/**
 * Seed the peer record the way ws-manager does on a `join`, because
 * RTCManager's ontrack ignores a peer it has no record of.
 */
function registerPeer(peerId: string): void {
  store.set(peerIdsAtom, (ids) => (ids.includes(peerId) ? ids : [...ids, peerId]));
  const existing = store.get(peerAtomFamily(peerId));
  if (existing) return;
  store.set(peerAtomFamily(peerId), {
    userId: peerId,
    user: { id: peerId, name: peerId },
    stream: null,
    screenStream: null,
    video: true,
    audio: true,
    screen: false,
    role: 'participant',
    handRaised: false,
    handRaisedAt: null,
  });
}

async function ensurePeer(peerId: string): Promise<RTCPeerConnection> {
  const existing = connections.get(peerId);
  if (existing) return existing;

  const { connection } = await RTCManager.createPeer(peerId, localStream);
  connections.set(peerId, connection);

  // createPeer routes candidates through WSManager, which is not connected to
  // the stub relay; re-point them at the relay. The candidate *generation* is
  // still the browser's, and `RTCManager.addIceCandidate` is still the real
  // queueing implementation.
  connection.onicecandidate = (event) => {
    if (event.candidate) send({ type: 'ice', to: peerId, candidate: event.candidate.toJSON() });
  };

  return connection;
}

async function offerTo(peerId: string): Promise<void> {
  const pc = await ensurePeer(peerId);
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  send({ type: 'offer', to: peerId, sdp: offer });
}

async function answerFor(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
  const pc = await ensurePeer(peerId);
  // The real call: it also drains anything the ICE queue buffered while the
  // remote description was missing.
  await RTCManager.setRemoteDescription(peerId, sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  send({ type: 'answer', to: peerId, sdp: answer });
}

function removePeer(peerId: string): void {
  RTCManager.removePeer(peerId);
  connections.delete(peerId);
}

async function handleSignal(signal: Signal): Promise<void> {
  const from = signal.peerId ?? signal.from ?? '';
  if (!from) return;

  switch (signal.type) {
    case 'peer-joined':
      signals.joined += 1;
      registerPeer(from);
      if (shouldOffer(from)) await offerTo(from);
      break;
    case 'offer':
      signals.offer += 1;
      registerPeer(from);
      await answerFor(from, signal.sdp as RTCSessionDescriptionInit);
      break;
    case 'answer':
      signals.answer += 1;
      await RTCManager.setRemoteDescription(from, signal.sdp as RTCSessionDescriptionInit);
      break;
    case 'ice':
      signals.ice += 1;
      // Real queueing: candidates that arrive before the remote description is
      // set are buffered and flushed by setRemoteDescription.
      RTCManager.addIceCandidate(from, signal.candidate as RTCIceCandidateInit);
      break;
    case 'peer-left':
      signals.peerLeft += 1;
      removePeer(from);
      break;
    default:
      break;
  }
}

function connectSignaling(): void {
  socket = new WebSocket(WS_URL);
  socket.onopen = () => send({ type: 'join', peerId: PEER_ID, roomId: ROOM_ID });
  socket.onmessage = (event) => {
    const signal = JSON.parse(event.data as string) as Signal;
    handleSignal(signal).catch((error) => {
      failure = String(error);
    });
  };
  socket.onerror = () => {
    failure = failure ?? 'signaling socket error';
  };
}

interface E2EStats {
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

async function collectStats(): Promise<E2EStats> {
  const stats: E2EStats = {
    peers: connections.size,
    connected: 0,
    failed: 0,
    bytesSent: 0,
    bytesReceived: 0,
    framesDecoded: 0,
    candidatePairsSucceeded: 0,
    storeRemoteTracks: 0,
    storeHasLiveVideo: false,
    signals: { ...signals },
    error: failure,
  };

  for (const pc of connections.values()) {
    if (pc.connectionState === 'connected') stats.connected += 1;
    if (pc.connectionState === 'failed') stats.failed += 1;
    const report = await pc.getStats();
    report.forEach((entry: Record<string, unknown>) => {
      if (entry.type === 'outbound-rtp' && !entry.isRemote) {
        stats.bytesSent += Number(entry.bytesSent ?? 0);
      }
      if (entry.type === 'inbound-rtp') {
        stats.bytesReceived += Number(entry.bytesReceived ?? 0);
        stats.framesDecoded += Number(entry.framesDecoded ?? 0);
      }
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded') {
        stats.candidatePairsSucceeded += 1;
      }
    });
  }

  for (const peerId of connections.keys()) {
    const peer = store.get(peerAtomFamily(peerId));
    const tracks = peer?.stream?.getTracks() ?? [];
    stats.storeRemoteTracks += tracks.length;
    if (tracks.some((track) => track.kind === 'video' && track.readyState === 'live')) {
      stats.storeHasLiveVideo = true;
    }
  }

  return stats;
}

function stop(): void {
  socket?.close();
  for (const peerId of [...connections.keys()]) removePeer(peerId);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
}

async function start(): Promise<void> {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { width: 320, height: 240, frameRate: 15 },
  });
  RTCManager.setLocalStream(localStream);
  await RTCManager.init();
  connectSignaling();
}

Object.defineProperty(window, '__e2e', {
  value: { peerId: PEER_ID, roomId: ROOM_ID, stats: collectStats, stop },
  writable: false,
});

void start().catch((error) => {
  failure = String(error);
});
