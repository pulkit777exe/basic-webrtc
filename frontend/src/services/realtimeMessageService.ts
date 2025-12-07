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
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private status: ConnectionStatus = "disconnected";
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private currentRoomName: string | null = null;
  private isManualDisconnect = false;
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 3; // Mark as disconnected after 3 consecutive failures
  private lastSuccessfulPoll: number = 0;
  private healthCheckTimeout = 10000; // 10 seconds - if no successful poll in this time, mark as disconnected

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
      this.startPolling(roomName);
    } catch (error) {
      console.error("Failed to connect to real-time service:", error);
      this.scheduleReconnect(roomName);
    }
  }

  private async verifyConnection(roomName: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `${APP_BACKEND_URL}/messages/${encodeURIComponent(roomName)}?limit=1`,
        {
          credentials: "include",
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (response.ok) {
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.warn("Connection verification failed:", error.message);
      }
      return false;
    }
  }

  private startPolling(roomName: string): void {
    // Clear any existing polling and health checks
    this.stopPolling();

    // First, verify the connection before marking as connected
    this.verifyConnection(roomName)
      .then((isConnected) => {
        if (this.isManualDisconnect || !this.currentRoomName || !navigator.onLine) {
          return;
        }

        if (isConnected) {
          this.setStatus("connected");
          this.reconnectAttempts = 0;
          this.consecutiveFailures = 0;
          this.lastSuccessfulPoll = Date.now();
          this.startPollingLoop(roomName);
          this.startHealthCheck(roomName);
        } else {
          // Connection verification failed, schedule reconnect
          this.scheduleReconnect(roomName);
        }
      })
      .catch(() => {
        this.scheduleReconnect(roomName);
      });
  }

  private startPollingLoop(roomName: string): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.pollingInterval = setInterval(async () => {
      if (this.isManualDisconnect || !this.currentRoomName || !navigator.onLine) {
        this.stopPolling();
        return;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
          `${APP_BACKEND_URL}/messages/${encodeURIComponent(roomName)}?limit=1`,
          {
            credentials: "include",
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (response.ok) {
          // Connection is healthy
          this.consecutiveFailures = 0;
          this.lastSuccessfulPoll = Date.now();
          
          // Only update status if we were reconnecting
          if (this.status === "reconnecting") {
            this.setStatus("connected");
          }
        } else {
          // Non-OK response, treat as failure
          this.handlePollingFailure(roomName);
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.warn("Polling error:", error.message);
          this.handlePollingFailure(roomName);
        }
      }
    }, 2000); // Poll every 2 seconds
  }

  private startHealthCheck(roomName: string): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      if (this.isManualDisconnect || !this.currentRoomName || !navigator.onLine) {
        return;
      }

      const timeSinceLastSuccess = Date.now() - this.lastSuccessfulPoll;
      
      // If no successful poll in the health check timeout, mark as disconnected
      if (timeSinceLastSuccess > this.healthCheckTimeout && this.status === "connected") {
        console.warn("Health check failed: No successful poll in", timeSinceLastSuccess, "ms");
        this.handlePollingFailure(roomName);
      }
    }, 5000); // Check health every 5 seconds
  }

  private handlePollingFailure(roomName: string): void {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      // Too many failures, mark as disconnected and reconnect
      console.warn("Too many consecutive failures, reconnecting...");
      this.stopPolling();
      this.setStatus("reconnecting");
      this.scheduleReconnect(roomName);
    } else if (this.status === "connected") {
      // Still connected but having issues, mark as reconnecting
      this.setStatus("reconnecting");
    }
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
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

    this.stopPolling();
    this.consecutiveFailures = 0;
    this.lastSuccessfulPoll = 0;

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

