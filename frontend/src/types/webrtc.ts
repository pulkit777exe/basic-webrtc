export interface Participant {
  userId: string;
  socketId: string;
  name: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: string;
  peerRole?: string;
}

export interface SdpData {
  type: "offer" | "answer";
  sdp: string;
}

export interface IceCandidateData {
  candidate: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
}

export const ConnectionState = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
} as const;

export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];

export const WebRTCErrorCode = {
  INVALID_MESSAGE: "INVALID_MESSAGE",
  RATE_LIMIT: "RATE_LIMIT",
  NOT_IN_ROOM: "NOT_IN_ROOM",
  NOT_PARTICIPANT: "NOT_PARTICIPANT",
  JOIN_FAILED: "JOIN_FAILED",
  ROOM_FULL: "ROOM_FULL",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type WebRTCErrorCode =
  (typeof WebRTCErrorCode)[keyof typeof WebRTCErrorCode];

export type ClientMessage =
  | { type: "join-room"; roomName: string; metadata?: Record<string, unknown> }
  | { type: "leave-room"; roomName: string }
  | { type: "offer"; to: string; sdp: SdpData }
  | { type: "answer"; to: string; sdp: SdpData }
  | { type: "ice-candidate"; to: string; candidate: IceCandidateData }
  | { type: "mute-audio"; muted: boolean }
  | { type: "mute-video"; muted: boolean }
  | { type: "heartbeat" };

export type ServerMessage =
  | { type: "room-joined"; roomName: string; participants: Participant[] }
  | { type: "peer-joined"; peer: Participant }
  | { type: "peer-left"; peerId: string }
  | { type: "offer"; from: string; sdp: SdpData }
  | { type: "answer"; from: string; sdp: SdpData }
  | { type: "ice-candidate"; from: string; candidate: IceCandidateData }
  | {
      type: "peer-muted";
      peerId: string;
      audioMuted: boolean;
      videoMuted: boolean;
    }
  | { type: "error"; message: string; code?: string }
  | { type: "pong" };

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

export const toSdpData = (desc: RTCSessionDescriptionInit): SdpData => ({
  type: desc.type as "offer" | "answer",
  sdp: desc.sdp || "",
});

export const fromSdpData = (sdp: SdpData): RTCSessionDescriptionInit => ({
  type: sdp.type,
  sdp: sdp.sdp,
});

export const toIceCandidateData = (
  candidate: RTCIceCandidate,
): IceCandidateData => ({
  candidate: candidate.candidate,
  sdpMLineIndex: candidate.sdpMLineIndex ?? null,
  sdpMid: candidate.sdpMid ?? null,
});

export const fromIceCandidateData = (
  data: IceCandidateData,
): RTCIceCandidateInit => ({
  candidate: data.candidate,
  sdpMLineIndex: data.sdpMLineIndex ?? undefined,
  sdpMid: data.sdpMid ?? undefined,
});
