import { WebSocket } from "ws";

export interface ConnectionMetadata {
  userId: string;
  username: string;
  socketId: string;
  roomName?: string;
  connectedAt: number;
  lastHeartbeat: number;
}

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 35000; // 35 seconds

/**
 * Extended WebSocket with connection metadata
 */
export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  metadata?: ConnectionMetadata;
}

/**
 * Setup heartbeat mechanism for WebSocket connection
 * @param ws - WebSocket connection
 */
export function setupHeartbeat(ws: ExtendedWebSocket): void {
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
    if (ws.metadata) {
      ws.metadata.lastHeartbeat = Date.now();
    }
  });

  // Send ping periodically
  const interval = setInterval(() => {
    if (ws.isAlive === false) {
      clearInterval(interval);
      return ws.terminate();
    }

    ws.isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  // Cleanup interval on close
  ws.on("close", () => {
    clearInterval(interval);
  });
}

/**
 * Check if connection has timed out
 */
export function isConnectionTimedOut(ws: ExtendedWebSocket): boolean {
  if (!ws.metadata) {
    return true;
  }

  const timeSinceLastHeartbeat = Date.now() - ws.metadata.lastHeartbeat;
  return timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT;
}

/**
 * Initialize connection metadata
 */
export function initializeConnectionMetadata(
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
 * Update connection room
 */
export function updateConnectionRoom(
  ws: ExtendedWebSocket,
  roomName: string
): void {
  if (ws.metadata) {
    ws.metadata.roomName = roomName;
  }
}

/**
 * Get connection metadata
 */
export function getConnectionMetadata(
  ws: ExtendedWebSocket
): ConnectionMetadata | undefined {
  return ws.metadata;
}

/**
 * Cleanup connection
 */
export function cleanupConnection(ws: ExtendedWebSocket): void {
  if (ws.metadata) {
    ws.metadata = undefined;
  }
}
