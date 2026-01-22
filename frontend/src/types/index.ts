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
  wsUrl: string;
  roomName: string;
  onDisconnected: () => void;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}
