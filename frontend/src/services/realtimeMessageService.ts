import { APP_BACKEND_URL } from "../constants";
import type { MessageResponse } from "./messageApi";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "offline";

export interface RealtimeMessageEvent {
  type: "message_created" | "message_updated" | "message_deleted";
  message: MessageResponse;
  roomName: string;
}

type MessageHandler = (event: RealtimeMessageEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;

class RealtimeMessageService {
  private eventSource: EventSource | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private status: ConnectionStatus = "disconnected";
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private currentRoomName: string | null = null;
  private isManualDisconnect = false;

  constructor() {
    // Listen to browser online/offline events
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        if (this.currentRoomName && !this.isManualDisconnect) {
          this.connect(this.currentRoomName);
        }
      });

      window.addEventListener("offline", () => {
        this.setStatus("offline");
      });
    }
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status !== status) {
      this.status = status;
      this.statusHandlers.forEach((handler) => handler(status));
    }
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  public onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public connect(roomName: string): void {
    if (this.isManualDisconnect) {
      return;
    }

    if (this.eventSource && this.currentRoomName === roomName && this.status === "connected") {
      return; // Already connected to this room
    }

    this.disconnect();
    this.currentRoomName = roomName;
    this.reconnectAttempts = 0;
    this.isManualDisconnect = false;

    if (!navigator.onLine) {
      this.setStatus("offline");
      return;
    }

    this.attemptConnection(roomName);
  }

  private attemptConnection(roomName: string): void {
    if (this.reconnectAttempts > 0) {
      this.setStatus("reconnecting");
    } else {
      this.setStatus("connecting");
    }

    try {
      // Use polling for now (can be upgraded to SSE/WebSocket later)
      // For now, we'll use a smart polling approach with exponential backoff
      this.startPolling(roomName);
    } catch (error) {
      console.error("Failed to connect to real-time service:", error);
      this.scheduleReconnect(roomName);
    }
  }

  private startPolling(roomName: string): void {
    // Clear any existing polling
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.setStatus("connected");
    this.reconnectAttempts = 0;

    // Poll for new messages every 1 second when connected
    const poll = async () => {
      if (this.isManualDisconnect || !this.currentRoomName || !navigator.onLine) {
        return;
      }

      try {
        const response = await fetch(
          `${APP_BACKEND_URL}/messages/${encodeURIComponent(roomName)}?limit=1`,
          {
            credentials: "include",
            signal: AbortSignal.timeout(5000), // 5 second timeout
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.messages && data.messages.length > 0) {
            // Check if this is a new message (would need to track last seen message ID)
            // For now, we'll let the useChat hook handle deduplication
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Polling error:", error);
          this.scheduleReconnect(roomName);
          return;
        }
      }

      if (!this.isManualDisconnect && this.currentRoomName === roomName && navigator.onLine) {
        this.reconnectTimeout = setTimeout(poll, 1000);
      }
    };

    poll();
  }

  private scheduleReconnect(roomName: string): void {
    if (this.isManualDisconnect || !navigator.onLine) {
      this.setStatus("offline");
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus("disconnected");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    this.reconnectTimeout = setTimeout(() => {
      this.attemptConnection(roomName);
    }, delay);
  }

  public disconnect(): void {
    this.isManualDisconnect = true;
    this.currentRoomName = null;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.setStatus("disconnected");
    this.reconnectAttempts = 0;
  }

  // Manually trigger a message event (for when we receive updates via polling)
  public notifyMessage(event: RealtimeMessageEvent): void {
    this.messageHandlers.forEach((handler) => handler(event));
  }
}

// Export singleton instance
export const realtimeMessageService = new RealtimeMessageService();

