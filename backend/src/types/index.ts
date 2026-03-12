import { WebSocket } from "ws";

export type RoomType = "open" | "locked";

export interface Participant {
  id: string;
  username: string;
  ws: WebSocket;
  joinedAt: number;
}

export interface PendingRequest {
  userId: string;
  username: string;
  ws: WebSocket;
  requestedAt: number;
}

export interface Room {
  id: string;
  type: RoomType;
  hostId: string;
  participants: Map<string, Participant>;
  pendingRequests: Map<string, PendingRequest>;
  createdAt: number;
}

export interface WSMessage {
  type:
    | "join-room"
    | "offer"
    | "answer"
    | "ice-candidate"
    | "request-join"
    | "approve-join"
    | "reject-join"
    | "user-left"
    | "start-screen-share"
    | "stop-screen-share"
    | "chat-message"
    | "get-chat-history"
    | "error"
    | "send-reaction"
    | "raise-hand"
    | "lower-hand"
    | "kick-user"
    | "mute-all"
    | "lock-room"
    | "unlock-room";
  payload: any;
}

export interface JoinRoomPayload {
  roomId: string;
  userId: string;
  username: string;
  roomType?: RoomType;
  isHost?: boolean;
}

export interface SignalingPayload {
  roomId: string;
  targetUserId: string;
  fromUserId: string;
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
}
export interface SignupPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface VerifyOtpPayload {
  email: string;
  code: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    avatarUrl?: string | null;
  };
  accessToken?: string;
  refreshToken?: string;
}

export interface FileAttachment {
  name: string;
  type: "image" | "pdf";
  mimeType: string;
  data: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
  file?: FileAttachment;
}

export interface RoomInfo {
  id: string;
  roomCode: string;
  type: RoomType;
  hostId: string;
  participantCount: number;
  createdAt: number;
}

export interface Reaction {
  userId: string;
  username: string;
  emoji: string;
  timestamp: number;
}

export interface HandRaiseState {
  userId: string;
  username: string;
  timestamp: number;
}
