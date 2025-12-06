import { APP_BACKEND_URL } from "../constants";
import type { BrowserInfo } from "../utils/browserInfo";
import { getBrowserInfo as getBrowserInfoUtil } from "../utils/browserInfo";

export type EventType =
  | "page_view"
  | "room_join"
  | "room_leave"
  | "message_sent"
  | "video_enabled"
  | "video_disabled"
  | "audio_enabled"
  | "audio_disabled"
  | "screen_share_started"
  | "screen_share_stopped"
  | "recording_started"
  | "recording_stopped";

export type Metadata = string | number | boolean | null;

interface QueuedEvent {
  eventType: EventType;
  timestamp: string;
  roomName?: string;
  metadata?: Record<string, Metadata>;
  browserInfo: BrowserInfo;
  sessionId: string;
  retryCount: number;
}

class AnalyticsAPI {
  private queue: QueuedEvent[] = [];
  private isProcessing = false;
  private batchSize = 10;
  private batchInterval = 5000; // 5 seconds
  private maxRetries = 3;
  private retryDelay = 1000; // 1 second
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private isOptedOut = false;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
    this.checkOptOutStatus();
    this.setupEventListeners();
    this.startBatchTimer();
  }

  // Generate or retrieve session ID
  private getOrCreateSessionId(): string {
    const stored = sessionStorage.getItem("analytics_session_id");
    if (stored) return stored;

    const newId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem("analytics_session_id", newId);
    return newId;
  }

  // Check if user has opted out
  private checkOptOutStatus(): void {
    this.isOptedOut = 
      localStorage.getItem("analytics_opt_out") === "true" ||
      navigator.doNotTrack === "1";
  }

  // Public method to opt out
  public optOut(): void {
    localStorage.setItem("analytics_opt_out", "true");
    this.isOptedOut = true;
    this.queue = [];
    console.log("Analytics tracking disabled");
  }

  // Public method to opt in
  public optIn(): void {
    localStorage.removeItem("analytics_opt_out");
    this.isOptedOut = false;
    console.log("Analytics tracking enabled");
  }

  // Collect comprehensive browser information
  public getBrowserInfo(): BrowserInfo {
    const baseInfo = getBrowserInfoUtil();
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string };
      deviceMemory?: number;
    };
    return {
      ...baseInfo,
      referrer: document.referrer || undefined,
      connection: nav.connection?.effectiveType,
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  }

  // Setup event listeners for offline/online and page visibility
  private setupEventListeners(): void {
    window.addEventListener("online", () => this.processQueue());
    window.addEventListener("offline", () => this.stopBatchTimer());
    
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.flushQueue();
      }
    });

    window.addEventListener("beforeunload", () => {
      this.flushQueue();
    });
  }

  // Start the batch timer
  private startBatchTimer(): void {
    if (this.batchTimer) return;
    
    this.batchTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }, this.batchInterval);
  }

  // Stop the batch timer
  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  // Track an event
  public async trackEvent(
    eventType: EventType,
    options: {
      roomName?: string;
      metadata?: Record<string, Metadata>;
      browserInfo?: BrowserInfo;
      sessionId?: string;
    } = {}
  ): Promise<void> {
    if (this.isOptedOut) return;

    const event: QueuedEvent = {
      eventType,
      timestamp: new Date().toISOString(),
      roomName: options.roomName,
      metadata: options.metadata,
      browserInfo: options.browserInfo || this.getBrowserInfo(),
      sessionId: options.sessionId || this.sessionId,
      retryCount: 0,
    };

    this.queue.push(event);

    // If queue is full, process immediately
    if (this.queue.length >= this.batchSize) {
      await this.processQueue();
    }
  }

  // Process the queue
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) {
      return;
    }

    this.isProcessing = true;

    const batch = this.queue.splice(0, this.batchSize);
    
    try {
      await this.sendBatch(batch);
    } catch {
      // Re-queue failed events with retry logic
      const retriableEvents = batch.filter(e => e.retryCount < this.maxRetries);
      retriableEvents.forEach(e => {
        e.retryCount++;
        this.queue.unshift(e);
      });

      if (retriableEvents.length > 0) {
        // Retry with exponential backoff
        const delay = this.retryDelay * Math.pow(2, retriableEvents[0].retryCount - 1);
        setTimeout(() => this.processQueue(), delay);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // Send a batch of events
  private async sendBatch(events: QueuedEvent[]): Promise<void> {
    const response = await fetch(`${APP_BACKEND_URL}/analytics/track-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      throw new Error(`Analytics batch failed: ${response.status}`);
    }

    if (import.meta.env.MODE === "development") {
      console.log(`Sent ${events.length} analytics events`);
    }
  }

  // Flush the queue immediately (used before page unload)
  private flushQueue(): void {
    if (this.queue.length === 0) return;

    const events = [...this.queue];
    this.queue = [];

    // Use sendBeacon for reliable delivery during page unload
    if (navigator.sendBeacon) {
      const blob = new Blob(
        [JSON.stringify({ events })],
        { type: "application/json" }
      );
      navigator.sendBeacon(`${APP_BACKEND_URL}/analytics/track-batch`, blob);
    }
  }

  // Get queue status (useful for debugging)
  public getQueueStatus(): { size: number; isProcessing: boolean } {
    return {
      size: this.queue.length,
      isProcessing: this.isProcessing,
    };
  }
}

// Export singleton instance
export const analyticsApi = new AnalyticsAPI();

// Convenience function for backward compatibility
export const trackEvent = (
  eventType: EventType,
  options?: {
    roomName?: string;
    metadata?: Record<string, Metadata>;
    browserInfo?: BrowserInfo;
    sessionId?: string;
  }
) => analyticsApi.trackEvent(eventType, options);