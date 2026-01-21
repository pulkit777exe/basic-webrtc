import { z } from "zod";

export interface Participant {
  userId: string;
  socketId: string;
  name: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: string;
  peerRole?: string;
}

export enum ConnectionState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  RECONNECTING = "reconnecting",
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

export const JoinRoomMessageSchema = z.object({
  type: z.literal("join-room"),
  roomName: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const LeaveRoomMessageSchema = z.object({
  type: z.literal("leave-room"),
  roomName: z.string().min(1).max(100),
});

export const OfferMessageSchema = z.object({
  type: z.literal("offer"),
  to: z.string().min(1),
  sdp: z.object({
    type: z.literal("offer"),
    sdp: z.string().min(1).max(100000),
  }),
});

export const AnswerMessageSchema = z.object({
  type: z.literal("answer"),
  to: z.string().min(1),
  sdp: z.object({
    type: z.literal("answer"),
    sdp: z.string().min(1).max(100000),
  }),
});

export const IceCandidateMessageSchema = z.object({
  type: z.literal("ice-candidate"),
  to: z.string().min(1),
  candidate: z.object({
    candidate: z.string().min(1).max(5000),
    sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
    sdpMid: z.string().nullable().optional(),
  }),
});

export const MuteAudioMessageSchema = z.object({
  type: z.literal("mute-audio"),
  muted: z.boolean(),
});

export const MuteVideoMessageSchema = z.object({
  type: z.literal("mute-video"),
  muted: z.boolean(),
});

export const HeartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  JoinRoomMessageSchema,
  LeaveRoomMessageSchema,
  OfferMessageSchema,
  AnswerMessageSchema,
  IceCandidateMessageSchema,
  MuteAudioMessageSchema,
  MuteVideoMessageSchema,
  HeartbeatMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type JoinRoomMessage = z.infer<typeof JoinRoomMessageSchema>;
export type LeaveRoomMessage = z.infer<typeof LeaveRoomMessageSchema>;
export type OfferMessage = z.infer<typeof OfferMessageSchema>;
export type AnswerMessage = z.infer<typeof AnswerMessageSchema>;
export type IceCandidateMessage = z.infer<typeof IceCandidateMessageSchema>;
export type MuteAudioMessage = z.infer<typeof MuteAudioMessageSchema>;
export type MuteVideoMessage = z.infer<typeof MuteVideoMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;

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

export const isJoinRoomMessage = (msg: ClientMessage): msg is JoinRoomMessage =>
  msg.type === "join-room";

export const isLeaveRoomMessage = (
  msg: ClientMessage,
): msg is LeaveRoomMessage => msg.type === "leave-room";

export const isOfferMessage = (msg: ClientMessage): msg is OfferMessage =>
  msg.type === "offer";

export const isAnswerMessage = (msg: ClientMessage): msg is AnswerMessage =>
  msg.type === "answer";

export const isIceCandidateMessage = (
  msg: ClientMessage,
): msg is IceCandidateMessage => msg.type === "ice-candidate";

export const isMuteAudioMessage = (
  msg: ClientMessage,
): msg is MuteAudioMessage => msg.type === "mute-audio";

export const isMuteVideoMessage = (
  msg: ClientMessage,
): msg is MuteVideoMessage => msg.type === "mute-video";

export const isHeartbeatMessage = (
  msg: ClientMessage,
): msg is HeartbeatMessage => msg.type === "heartbeat";

export const validateRoomName = (roomName: string): boolean => {
  return roomName.length >= 1 && roomName.length <= 100;
};

export const validateSocketId = (socketId: string): boolean => {
  return socketId.length >= 1 && socketId.length <= 100;
};

export const validateParticipant = (
  participant: unknown,
): participant is Participant => {
  if (!participant || typeof participant !== "object") {
    return false;
  }

  const p = participant as Record<string, unknown>;

  return (
    typeof p.userId === "string" &&
    typeof p.socketId === "string" &&
    typeof p.name === "string" &&
    typeof p.isAudioMuted === "boolean" &&
    typeof p.isVideoMuted === "boolean" &&
    typeof p.joinedAt === "string"
  );
};

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

export const MAX_ROOM_NAME_LENGTH = 100;
export const MAX_SDP_LENGTH = 100000;
export const MAX_ICE_CANDIDATE_LENGTH = 5000;
export const MAX_METADATA_SIZE = 10000;
