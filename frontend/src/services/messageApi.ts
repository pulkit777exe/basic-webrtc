import { APP_BACKEND_URL } from "../constants";
import type { BrowserInfo } from "../utils/browserInfo";

export interface MessageResponse {
  id: string;
  content: string;
  sender: string;
  senderId: string;
  timestamp: string;
}

export interface MessagesResponse {
  messages: MessageResponse[];
  nextCursor: string | null;
}

interface PendingMessage {
  tempId: string;
  roomName: string;
  content: string;
  browserInfo: BrowserInfo;
  sessionId: string;
  retryCount: number;
  timestamp: Date;
}

class MessageAPI {
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private messageCache: Map<string, MessagesResponse> = new Map();
  private maxRetries = 3;
  private retryDelay = 1000;
  private cacheTimeout = 30000; // 30 seconds
  private rateLimitDelay = 100; // 100ms between requests
  private lastRequestTime = 0;

  constructor() {
    this.setupEventListeners();
  }

  // Setup event listeners for offline/online
  private setupEventListeners(): void {
    window.addEventListener("online", () => this.retryPendingMessages());
  }

  // Generate temporary ID for optimistic updates
  private generateTempId(): string {
    return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Rate limiting helper
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  // Retry with exponential backoff
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retryCount: number
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retryCount >= this.maxRetries) {
        throw error;
      }

      const delay = this.retryDelay * Math.pow(2, retryCount);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return this.retryWithBackoff(fn, retryCount + 1);
    }
  }

  // Send a message with retry logic and offline support
  public async sendMessage(
    roomName: string,
    content: string,
    browserInfo: BrowserInfo,
    sessionId: string,
    options: {
      onOptimisticUpdate?: (tempMessage: MessageResponse) => void;
      onSuccess?: (message: MessageResponse) => void;
      onError?: (error: Error) => void;
    } = {}
  ): Promise<MessageResponse> {
    const tempId = this.generateTempId();
    
    // Create optimistic message
    const optimisticMessage: MessageResponse = {
      id: tempId,
      content,
      sender: "You",
      senderId: sessionId,
      timestamp: new Date().toISOString(),
    };

    // Call optimistic update callback
    options.onOptimisticUpdate?.(optimisticMessage);

    // If offline, queue the message
    if (!navigator.onLine) {
      this.pendingMessages.set(tempId, {
        tempId,
        roomName,
        content,
        browserInfo,
        sessionId,
        retryCount: 0,
        timestamp: new Date(),
      });
      
      return optimisticMessage;
    }

    try {
      await this.applyRateLimit();

      const message = await this.retryWithBackoff(
        async () => {
          const response = await fetch(`${APP_BACKEND_URL}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              roomName,
              content,
              browserInfo,
              sessionId,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to send message: ${response.status} - ${errorText}`);
          }

          return await response.json();
        },
        0
      );

      const messageResponse: MessageResponse = {
        id: message.id,
        content: message.content,
        sender: message.sender,
        senderId: message.senderId,
        timestamp: message.timestamp,
      };

      // Invalidate cache for this room
      this.invalidateCache(roomName);

      options.onSuccess?.(messageResponse);
      return messageResponse;
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Failed to send message");
      
      // Queue for retry if network error
      if (!navigator.onLine || err.message.includes("fetch")) {
        this.pendingMessages.set(tempId, {
          tempId,
          roomName,
          content,
          browserInfo,
          sessionId,
          retryCount: 0,
          timestamp: new Date(),
        });
      }

      options.onError?.(err);
      throw err;
    }
  }

  // Retry all pending messages
  private async retryPendingMessages(): Promise<void> {
    const messages = Array.from(this.pendingMessages.values());
    
    for (const msg of messages) {
      try {
        await this.sendMessage(
          msg.roomName,
          msg.content,
          msg.browserInfo,
          msg.sessionId
        );
        this.pendingMessages.delete(msg.tempId);
      } catch (error) {
        msg.retryCount++;
        if (msg.retryCount >= this.maxRetries) {
          this.pendingMessages.delete(msg.tempId);
          console.error("Failed to send message after max retries:", error);
        }
      }
    }
  }

  // Get messages with caching
  public async getMessages(
    roomName: string,
    limit: number = 50,
    cursor?: string,
    options: {
      useCache?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<MessagesResponse> {
    const cacheKey = `${roomName}_${limit}_${cursor || "initial"}`;
    
    // Return cached data if available and not expired
    if (options.useCache !== false) {
      const cached = this.messageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    await this.applyRateLimit();

    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (cursor) {
      params.append("cursor", cursor);
    }

    try {
      const response = await fetch(
        `${APP_BACKEND_URL}/messages/${encodeURIComponent(roomName)}?${params}`,
        {
          credentials: "include",
          signal: options.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const data: MessagesResponse = await response.json();
      
      // Cache the response
      this.messageCache.set(cacheKey, data);
      
      // Auto-invalidate cache after timeout
      setTimeout(() => {
        this.messageCache.delete(cacheKey);
      }, this.cacheTimeout);

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      
      throw new Error(
        `Failed to fetch messages: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // Load all messages with pagination
  public async getAllMessages(
    roomName: string,
    onProgress?: (messages: MessageResponse[]) => void
  ): Promise<MessageResponse[]> {
    const allMessages: MessageResponse[] = [];
    let cursor: string | null = null;

    do {
      const response = await this.getMessages(roomName, 50, cursor || undefined);
      allMessages.push(...response.messages);
      cursor = response.nextCursor;
      
      onProgress?.(allMessages);
    } while (cursor);

    return allMessages;
  }

  // Invalidate cache for a specific room
  public invalidateCache(roomName: string): void {
    const keysToDelete: string[] = [];
    
    this.messageCache.forEach((_, key) => {
      if (key.startsWith(roomName)) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => this.messageCache.delete(key));
  }

  // Clear all caches
  public clearAllCaches(): void {
    this.messageCache.clear();
  }

  // Get pending messages count
  public getPendingCount(): number {
    return this.pendingMessages.size;
  }

  // Get pending messages for a room
  public getPendingMessages(roomName: string): PendingMessage[] {
    return Array.from(this.pendingMessages.values())
      .filter(msg => msg.roomName === roomName);
  }

  // Delete a message (if your backend supports it)
  public async deleteMessage(
    roomName: string,
    messageId: string
  ): Promise<void> {
    await this.applyRateLimit();

    const response = await fetch(
      `${APP_BACKEND_URL}/messages/${encodeURIComponent(roomName)}/${messageId}`,
      {
        method: "DELETE",
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete message: ${response.status}`);
    }

    this.invalidateCache(roomName);
  }

  // Edit a message (if your backend supports it)
  public async editMessage(
    roomName: string,
    messageId: string,
    newContent: string
  ): Promise<MessageResponse> {
    await this.applyRateLimit();

    const response = await fetch(
      `${APP_BACKEND_URL}/messages/${encodeURIComponent(roomName)}/${messageId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ content: newContent }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to edit message: ${response.status}`);
    }

    const data = await response.json();
    this.invalidateCache(roomName);
    
    return {
      id: data.id,
      content: data.content,
      sender: data.sender,
      senderId: data.senderId,
      timestamp: data.timestamp,
    };
  }
}

// Export singleton instance
export const messageApi = new MessageAPI();