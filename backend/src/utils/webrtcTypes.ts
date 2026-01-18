import { z } from "zod";

// Participant interface
export interface Participant {
  userId: string;
  socketId: string;
  name: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  joinedAt: string;
  peerRole?: string;
}

export const JoinRoomMessageSchema = z.object({
  type: z.literal("join-room"),
  roomName: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const LeaveRoomMessageSchema = z.object({
  type: z.literal("leave-room"),
  roomName: z.string().min(1),
});

export const OfferMessageSchema = z.object({
  type: z.literal("offer"),
  to: z.string().min(1),
  sdp: z.object({
    type: z.literal("offer"),
    sdp: z.string(),
  }),
});

export const AnswerMessageSchema = z.object({
  type: z.literal("answer"),
  to: z.string().min(1),
  sdp: z.object({
    type: z.literal("answer"),
    sdp: z.string(),
  }),
});

export const IceCandidateMessageSchema = z.object({
  type: z.literal("ice-candidate"),
  to: z.string().min(1),
  candidate: z.object({
    candidate: z.string(),
    sdpMLineIndex: z.number().nullable().optional(),
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

export const ClientMessageSchema = z.union([
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

// Server -> Client Message Types
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
  sdp: RTCSessionDescriptionInit;
}

export interface ServerAnswerMessage {
  type: "answer";
  from: string;
  sdp: RTCSessionDescriptionInit;
}

export interface ServerIceCandidateMessage {
  type: "ice-candidate";
  from: string;
  candidate: RTCIceCandidateInit;
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

// Connection state
export enum ConnectionState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  RECONNECTING = "reconnecting",
}
