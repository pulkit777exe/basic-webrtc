export interface Peer {
  userId: string;
  username: string;
  stream?: MediaStream;
  screenStream?: MediaStream;
  connection?: RTCPeerConnection;
}

export interface RoomState {
  roomId: string;
  userId: string;
  username: string;
  isHost: boolean;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  peers: Map<string, Peer>;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
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

export interface User {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

export type WSMessageType =
  | "join-room"
  | "room-joined"
  | "user-joined"
  | "user-left"
  | "offer"
  | "answer"
  | "ice-candidate"
  | "request-join"
  | "join-request"
  | "approve-join"
  | "reject-join"
  | "join-approved"
  | "join-rejected"
  | "start-screen-share"
  | "stop-screen-share"
  | "user-started-screen-share"
  | "user-stopped-screen-share"
  | "chat-message"
  | "chat-history"
  | "get-chat-history"
  | "error";

export interface WSMessage {
  type: WSMessageType;
  payload: any;
}
