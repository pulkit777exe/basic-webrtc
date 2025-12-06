export type MessageStatus = "sending" | "sent" | "failed";

export interface ChatMessage {
  id: string;
  sender: string;
  message: string;
  timestamp: Date;
  isOwn: boolean;
  status?: MessageStatus;
}

export interface VideoRoomProps {
  token: string;
  serverUrl: string;
  roomName: string;
  onDisconnected: () => void;
}

