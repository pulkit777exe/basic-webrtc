import { createClient, RedisClientType } from "redis";

let publisher: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;

/**
 * Initialize Redis clients (publisher and subscriber)
 */
export async function initializeRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    publisher = createClient({ url: redisUrl }) as RedisClientType;
    subscriber = createClient({ url: redisUrl }) as RedisClientType;

    publisher.on("error", (err) => {
      console.error("Redis Publisher error:", err);
    });

    subscriber.on("error", (err) => {
      console.error("Redis Subscriber error:", err);
    });

    await publisher.connect();
    await subscriber.connect();

    console.log("Redis clients connected successfully");
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
    throw error;
  }
}

/**
 * Get Redis publisher client
 */
export function getPublisher(): RedisClientType {
  if (!publisher || !publisher.isOpen) {
    throw new Error("Redis publisher not initialized or disconnected");
  }
  return publisher;
}

/**
 * Get Redis subscriber client
 */
export function getSubscriber(): RedisClientType {
  if (!subscriber || !subscriber.isOpen) {
    throw new Error("Redis subscriber not initialized or disconnected");
  }
  return subscriber;
}

/**
 * Publish message to a room channel
 */
export async function publishToRoom(
  roomName: string,
  message: unknown
): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.publish(`room:${roomName}:messages`, JSON.stringify(message));
  } catch (error) {
    console.error(`Failed to publish to room ${roomName}:`, error);
    throw error;
  }
}

/**
 * Publish room event (join/leave)
 */
export async function publishRoomEvent(
  roomName: string,
  event: unknown
): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.publish(`room:${roomName}:events`, JSON.stringify(event));
  } catch (error) {
    console.error(`Failed to publish room event for ${roomName}:`, error);
    throw error;
  }
}

/**
 * Subscribe to room messages
 */
export async function subscribeToRoomMessages(
  roomName: string,
  callback: (message: unknown) => void
): Promise<void> {
  try {
    const sub = getSubscriber();
    await sub.subscribe(`room:${roomName}:messages`, (message) => {
      try {
        const parsed = JSON.parse(message);
        callback(parsed);
      } catch (error) {
        console.error("Failed to parse room message:", error);
      }
    });
  } catch (error) {
    console.error(`Failed to subscribe to room ${roomName}:`, error);
    throw error;
  }
}

/**
 * Subscribe to room events
 */
export async function subscribeToRoomEvents(
  roomName: string,
  callback: (event: unknown) => void
): Promise<void> {
  try {
    const sub = getSubscriber();
    await sub.subscribe(`room:${roomName}:events`, (message) => {
      try {
        const parsed = JSON.parse(message);
        callback(parsed);
      } catch (error) {
        console.error("Failed to parse room event:", error);
      }
    });
  } catch (error) {
    console.error(`Failed to subscribe to room events for ${roomName}:`, error);
    throw error;
  }
}

/**
 * Unsubscribe from room messages
 */
export async function unsubscribeFromRoomMessages(roomName: string): Promise<void> {
  try {
    const sub = getSubscriber();
    await sub.unsubscribe(`room:${roomName}:messages`);
  } catch (error) {
    console.error(`Failed to unsubscribe from room ${roomName}:`, error);
  }
}

/**
 * Unsubscribe from room events
 */
export async function unsubscribeFromRoomEvents(roomName: string): Promise<void> {
  try {
    const sub = getSubscriber();
    await sub.unsubscribe(`room:${roomName}:events`);
  } catch (error) {
    console.error(`Failed to unsubscribe from room events for ${roomName}:`, error);
  }
}

/**
 * Add participant to Redis set
 */
export async function addParticipantToRoom(
  roomName: string,
  socketId: string
): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.sAdd(`room:${roomName}:participants`, socketId);
  } catch (error) {
    console.error(`Failed to add participant to room ${roomName}:`, error);
  }
}

/**
 * Remove participant from Redis set
 */
export async function removeParticipantFromRoom(
  roomName: string,
  socketId: string
): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.sRem(`room:${roomName}:participants`, socketId);
  } catch (error) {
    console.error(`Failed to remove participant from room ${roomName}:`, error);
  }
}

/**
 * Get all participants in a room from Redis
 */
export async function getRoomParticipants(
  roomName: string
): Promise<string[]> {
  try {
    const pub = getPublisher();
    return await pub.sMembers(`room:${roomName}:participants`);
  } catch (error) {
    console.error(`Failed to get participants for room ${roomName}:`, error);
    return [];
  }
}

/**
 * Set socket metadata in Redis
 */
export async function setSocketMetadata(
  socketId: string,
  metadata: { userId: string; roomName: string; serverId?: string }
): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.hSet(`socket:${socketId}:metadata`, {
      userId: metadata.userId,
      roomName: metadata.roomName,
      serverId: metadata.serverId || "default",
    });
    // Set expiration (24 hours)
    await pub.expire(`socket:${socketId}:metadata`, 86400);
  } catch (error) {
    console.error(`Failed to set socket metadata for ${socketId}:`, error);
  }
}

/**
 * Get socket metadata from Redis
 */
export async function getSocketMetadata(
  socketId: string
): Promise<{ userId: string; roomName: string; serverId: string } | null> {
  try {
    const pub = getPublisher();
    const metadata = await pub.hGetAll(`socket:${socketId}:metadata`);
    if (Object.keys(metadata).length === 0) {
      return null;
    }
    return {
      userId: metadata.userId,
      roomName: metadata.roomName,
      serverId: metadata.serverId || "default",
    };
  } catch (error) {
    console.error(`Failed to get socket metadata for ${socketId}:`, error);
    return null;
  }
}

/**
 * Remove socket metadata from Redis
 */
export async function removeSocketMetadata(socketId: string): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.del(`socket:${socketId}:metadata`);
  } catch (error) {
    console.error(`Failed to remove socket metadata for ${socketId}:`, error);
  }
}

/**
 * Gracefully close Redis connections
 */
export async function closeRedis(): Promise<void> {
  try {
    if (publisher && publisher.isOpen) {
      await publisher.quit();
    }
    if (subscriber && subscriber.isOpen) {
      await subscriber.quit();
    }
    console.log("Redis connections closed");
  } catch (error) {
    console.error("Error closing Redis connections:", error);
  }
}
