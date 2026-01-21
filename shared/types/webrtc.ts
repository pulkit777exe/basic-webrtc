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

export enum ConnectionState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  RECONNECTING = "reconnecting",
}

export enum WebRTCErrorCode {
  INVALID_MESSAGE = "INVALID_MESSAGE",
  RATE_LIMIT = "RATE_LIMIT",
  NOT_IN_ROOM = "NOT_IN_ROOM",
  NOT_PARTICIPANT = "NOT_PARTICIPANT",
  JOIN_FAILED = "JOIN_FAILED",
  ROOM_FULL = "ROOM_FULL",
  ROOM_NOT_FOUND = "ROOM_NOT_FOUND",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

// ============================================================================
// Client -> Server Messages
// ============================================================================

export interface JoinRoomMessage {
  type: "join-room";
  roomName: string;
  metadata?: Record<string, unknown>;
}

export interface LeaveRoomMessage {
  type: "leave-room";
  roomName: string;
}

export interface OfferMessage {
  type: "offer";
  to: string;
  sdp: SdpData;
}

export interface AnswerMessage {
  type: "answer";
  to: string;
  sdp: SdpData;
}

export interface IceCandidateMessage {
  type: "ice-candidate";
  to: string;
  candidate: IceCandidateData;
}

export interface MuteAudioMessage {
  type: "mute-audio";
  muted: boolean;
}

export interface MuteVideoMessage {
  type: "mute-video";
  muted: boolean;
}

export interface HeartbeatMessage {
  type: "heartbeat";
}

export type ClientMessage =
  | JoinRoomMessage
  | LeaveRoomMessage
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | MuteAudioMessage
  | MuteVideoMessage
  | HeartbeatMessage;

// ============================================================================
// Server -> Client Messages
// ============================================================================

export interface RoomJoinedMessage {
  type: "room-joined";
  roomName: string;
  participants: Participant[];
}

export interface PeerJoinedMessage {
  type: "peer-joined";
  peer: Participant;
}

export interface PeerLeftMessage {
  type: "peer-left";
  peerId: string;
}

export interface ServerOfferMessage {
  type: "offer";
  from: string;
  sdp: SdpData;
}

export interface ServerAnswerMessage {
  type: "answer";
  from: string;
  sdp: SdpData;
}

export interface ServerIceCandidateMessage {
  type: "ice-candidate";
  from: string;
  candidate: IceCandidateData;
}

export interface PeerMutedMessage {
  type: "peer-muted";
  peerId: string;
  audioMuted: boolean;
  videoMuted: boolean;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  code?: string;
}

export interface PongMessage {
  type: "pong";
}

export type ServerMessage =
  | RoomJoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | ServerOfferMessage
  | ServerAnswerMessage
  | ServerIceCandidateMessage
  | PeerMutedMessage
  | ErrorMessage
  | PongMessage;

// ============================================================================
// Redis Pub/Sub Event Types
// ============================================================================

export interface RedisPeerJoinedEvent {
  type: "peer-joined";
  socketId: string;
  roomName: string;
}

export interface RedisPeerLeftEvent {
  type: "peer-left";
  socketId: string;
  roomName: string;
}

export type RedisRoomEvent = RedisPeerJoinedEvent | RedisPeerLeftEvent;

export interface RedisSignalingMessage {
  type: "offer" | "answer" | "ice-candidate";
  from: string;
  to: string;
  sdp?: SdpData;
  candidate?: IceCandidateData;
}

// ============================================================================
// Constants
// ============================================================================

export const MAX_ROOM_NAME_LENGTH = 100;
export const MAX_SDP_LENGTH = 100000;
export const MAX_ICE_CANDIDATE_LENGTH = 5000;
export const MAX_METADATA_SIZE = 10000;
