// WebRTC types matching backend protocol

export interface Participant {
  userId: string;
  socketId: string;
  name: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: string;
  peerRole?: string;
}

// Client -> Server Messages
export type ClientMessage =
  | { type: "join-room"; roomName: string; metadata?: Record<string, unknown> }
  | { type: "leave-room"; roomName: string }
  | { type: "offer"; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; to: string; candidate: RTCIceCandidateInit }
  | { type: "mute-audio"; muted: boolean }
  | { type: "mute-video"; muted: boolean }
  | { type: "heartbeat" };

// Server -> Client Messages
export type ServerMessage =
  | { type: "room-joined"; roomName: string; participants: Participant[] }
  | { type: "peer-joined"; peer: Participant }
  | { type: "peer-left"; peerId: string }
  | { type: "offer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; from: string; candidate: RTCIceCandidateInit }
  | { type: "peer-muted"; peerId: string; audioMuted: boolean; videoMuted: boolean }
  | { type: "error"; message: string; code?: string }
  | { type: "pong" };

export const ConnectionState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
} as const;

export type ConnectionState = typeof ConnectionState[keyof typeof ConnectionState];

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}
