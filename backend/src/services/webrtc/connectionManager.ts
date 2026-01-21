import { WebSocket } from "ws";

// Configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 35000; // 35 seconds

// Types
export interface ConnectionMetadata {
  userId: string;
  username: string;
  socketId: string;
  roomName?: string;
  connectedAt: number;
  lastHeartbeat: number;
}

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  metadata?: ConnectionMetadata;
}

// Heartbeat manager
class HeartbeatManager {
  private intervals = new Map<string, NodeJS.Timeout>();

  /**
   * Start heartbeat for a connection
   */
  start(ws: ExtendedWebSocket): void {
    if (!ws.metadata) {
      throw new Error("Cannot start heartbeat without metadata");
    }

    const socketId = ws.metadata.socketId;

    // Clear existing interval if any
    this.stop(socketId);

    // Initialize as alive
    ws.isAlive = true;

    // Setup pong handler
    const pongHandler = () => {
      ws.isAlive = true;
      if (ws.metadata) {
        ws.metadata.lastHeartbeat = Date.now();
      }
    };

    ws.on("pong", pongHandler);

    // Start ping interval
    const interval = setInterval(() => {
      if (!ws.isAlive) {
        this.stop(socketId);
        ws.terminate();
        return;
      }

      ws.isAlive = false;

      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL);

    this.intervals.set(socketId, interval);

    // Cleanup on close
    ws.once("close", () => {
      this.stop(socketId);
      ws.removeListener("pong", pongHandler);
    });
  }

  /**
   * Stop heartbeat for a connection
   */
  stop(socketId: string): void {
    const interval = this.intervals.get(socketId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(socketId);
    }
  }

  /**
   * Check if connection has timed out
   */
  isTimedOut(ws: ExtendedWebSocket): boolean {
    if (!ws.metadata) {
      return true;
    }

    const timeSinceLastHeartbeat = Date.now() - ws.metadata.lastHeartbeat;
    return timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT;
  }

  /**
   * Get heartbeat status
   */
  getStatus(ws: ExtendedWebSocket): {
    isAlive: boolean;
    lastHeartbeat?: number;
    timeSinceLastHeartbeat?: number;
  } {
    if (!ws.metadata) {
      return { isAlive: false };
    }

    return {
      isAlive: ws.isAlive,
      lastHeartbeat: ws.metadata.lastHeartbeat,
      timeSinceLastHeartbeat: Date.now() - ws.metadata.lastHeartbeat,
    };
  }

  /**
   * Clear all intervals (for shutdown)
   */
  clearAll(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}

// Metadata manager
class MetadataManager {
  /**
   * Initialize connection metadata
   */
  initialize(
    ws: ExtendedWebSocket,
    userId: string,
    username: string,
    socketId: string
  ): void {
    ws.metadata = {
      userId,
      username,
      socketId,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };
  }

  /**
   * Update room information
   */
  updateRoom(ws: ExtendedWebSocket, roomName: string): void {
    if (!ws.metadata) {
      throw new Error("Cannot update room without metadata");
    }

    ws.metadata.roomName = roomName;
  }

  /**
   * Clear room information
   */
  clearRoom(ws: ExtendedWebSocket): void {
    if (ws.metadata) {
      ws.metadata.roomName = undefined;
    }
  }

  /**
   * Get metadata
   */
  get(ws: ExtendedWebSocket): ConnectionMetadata | undefined {
    return ws.metadata;
  }

  /**
   * Check if metadata exists and is valid
   */
  isValid(ws: ExtendedWebSocket): boolean {
    return (
      !!ws.metadata &&
      !!ws.metadata.userId &&
      !!ws.metadata.username &&
      !!ws.metadata.socketId
    );
  }

  /**
   * Get connection duration in milliseconds
   */
  getConnectionDuration(ws: ExtendedWebSocket): number | null {
    if (!ws.metadata) {
      return null;
    }

    return Date.now() - ws.metadata.connectedAt;
  }

  /**
   * Cleanup metadata
   */
  cleanup(ws: ExtendedWebSocket): void {
    ws.metadata = undefined;
  }
}

// Global instances
const heartbeatManager = new HeartbeatManager();
const metadataManager = new MetadataManager();

// Public API
/**
 * Setup heartbeat mechanism for WebSocket connection
 * @param ws - WebSocket connection
 */
export const setupHeartbeat = (ws: ExtendedWebSocket): void => {
  heartbeatManager.start(ws);
};

/**
 * Stop heartbeat for a connection
 * @param socketId - Socket ID to stop heartbeat for
 */
export const stopHeartbeat = (socketId: string): void => {
  heartbeatManager.stop(socketId);
};

/**
 * Check if connection has timed out
 * @param ws - WebSocket connection
 * @returns True if connection has timed out
 */
export const isConnectionTimedOut = (ws: ExtendedWebSocket): boolean => {
  return heartbeatManager.isTimedOut(ws);
};

/**
 * Get heartbeat status for a connection
 * @param ws - WebSocket connection
 * @returns Status object with heartbeat information
 */
export const getHeartbeatStatus = (
  ws: ExtendedWebSocket
): ReturnType<typeof heartbeatManager.getStatus> => {
  return heartbeatManager.getStatus(ws);
};

/**
 * Initialize connection metadata
 * @param ws - WebSocket connection
 * @param userId - User ID
 * @param username - Username
 * @param socketId - Socket ID
 */
export const initializeConnectionMetadata = (
  ws: ExtendedWebSocket,
  userId: string,
  username: string,
  socketId: string
): void => {
  metadataManager.initialize(ws, userId, username, socketId);
};

/**
 * Update connection room
 * @param ws - WebSocket connection
 * @param roomName - Room name to join
 */
export const updateConnectionRoom = (
  ws: ExtendedWebSocket,
  roomName: string
): void => {
  metadataManager.updateRoom(ws, roomName);
};

/**
 * Clear connection room
 * @param ws - WebSocket connection
 */
export const clearConnectionRoom = (ws: ExtendedWebSocket): void => {
  metadataManager.clearRoom(ws);
};

/**
 * Get connection metadata
 * @param ws - WebSocket connection
 * @returns Metadata object or undefined
 */
export const getConnectionMetadata = (
  ws: ExtendedWebSocket
): ConnectionMetadata | undefined => {
  return metadataManager.get(ws);
};

/**
 * Check if connection metadata is valid
 * @param ws - WebSocket connection
 * @returns True if metadata exists and is valid
 */
export const isConnectionMetadataValid = (ws: ExtendedWebSocket): boolean => {
  return metadataManager.isValid(ws);
};

/**
 * Get connection duration
 * @param ws - WebSocket connection
 * @returns Duration in milliseconds or null if no metadata
 */
export const getConnectionDuration = (ws: ExtendedWebSocket): number | null => {
  return metadataManager.getConnectionDuration(ws);
};

/**
 * Cleanup connection (metadata and heartbeat)
 * @param ws - WebSocket connection
 */
export const cleanupConnection = (ws: ExtendedWebSocket): void => {
  if (ws.metadata) {
    heartbeatManager.stop(ws.metadata.socketId);
  }
  metadataManager.cleanup(ws);
};

/**
 * Cleanup all connections (for shutdown)
 */
export const cleanupAllConnections = (): void => {
  heartbeatManager.clearAll();
};