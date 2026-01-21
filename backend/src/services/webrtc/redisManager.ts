import { createClient, RedisClientType } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const SOCKET_METADATA_TTL = 86400; // 24
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 1000;

interface SocketMetadata {
  userId: string;
  roomName: string;
  serverId?: string;
}

interface RedisClientConfig {
  url: string;
  socket: {
    reconnectStrategy: (retries: number) => number | Error;
  };
}

class RedisClientManager {
  private publisher: RedisClientType | null = null;
  private subscriber: RedisClientType | null = null;
  private isInitialized = false;
  private reconnectAttempts = 0;

  private createReconnectStrategy() {
    return (retries: number): number | Error => {
      if (retries >= MAX_RECONNECT_ATTEMPTS) {
        return new Error("Max reconnection attempts reached");
      }
      this.reconnectAttempts = retries;
      return Math.min(retries * RECONNECT_DELAY, 5000);
    };
  }

  private createClientConfig(): RedisClientConfig {
    return {
      url: REDIS_URL,
      socket: {
        reconnectStrategy: this.createReconnectStrategy(),
      },
    };
  }

  private setupClientHandlers(client: RedisClientType, name: string): void {
    client.on("error", (err) => {
      console.error(`Redis ${name} error:`, err);
    });

    client.on("connect", () => {
      console.log(`Redis ${name} connecting...`);
    });

    client.on("ready", () => {
      console.log(`Redis ${name} ready`);
      this.reconnectAttempts = 0;
    });

    client.on("reconnecting", () => {
      console.log(`Redis ${name} reconnecting (attempt ${this.reconnectAttempts})...`);
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn("Redis clients already initialized");
      return;
    }

    try {
      this.publisher = createClient(this.createClientConfig()) as RedisClientType;
      this.subscriber = createClient(this.createClientConfig()) as RedisClientType;

      this.setupClientHandlers(this.publisher, "Publisher");
      this.setupClientHandlers(this.subscriber, "Subscriber");

      await Promise.all([
        this.publisher.connect(),
        this.subscriber.connect(),
      ]);

      this.isInitialized = true;
      console.log("Redis clients connected successfully");
    } catch (error) {
      console.error("Failed to initialize Redis:", error);
      throw error;
    }
  }

  getPublisher(): RedisClientType {
    if (!this.publisher?.isOpen) {
      throw new Error("Redis publisher not initialized or disconnected");
    }
    return this.publisher;
  }

  getSubscriber(): RedisClientType {
    if (!this.subscriber?.isOpen) {
      throw new Error("Redis subscriber not initialized or disconnected");
    }
    return this.subscriber;
  }

  async close(): Promise<void> {
    try {
      const closePromises: Promise<unknown>[] = [];

      if (this.publisher?.isOpen) {
        closePromises.push(this.publisher.quit());
      }

      if (this.subscriber?.isOpen) {
        closePromises.push(this.subscriber.quit());
      }

      await Promise.all(closePromises);

      this.publisher = null;
      this.subscriber = null;
      this.isInitialized = false;

      console.log("Redis connections closed");
    } catch (error) {
      console.error("Error closing Redis connections:", error);
      throw error;
    }
  }

  isReady(): boolean {
    return this.isInitialized && 
           !!this.publisher?.isOpen && 
           !!this.subscriber?.isOpen;
  }
}

const clientManager = new RedisClientManager();

const buildRoomMessagesKey = (roomName: string): string => 
  `room:${roomName}:messages`;

const buildRoomEventsKey = (roomName: string): string => 
  `room:${roomName}:events`;

const buildRoomParticipantsKey = (roomName: string): string => 
  `room:${roomName}:participants`;

const buildSocketMetadataKey = (socketId: string): string => 
  `socket:${socketId}:metadata`;

const withErrorHandling = async <T>(
  operation: () => Promise<T>,
  errorMessage: string,
  fallbackValue?: T
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    console.error(errorMessage, error);
    if (fallbackValue !== undefined) {
      return fallbackValue;
    }
    throw error;
  }
};

export const initializeRedis = (): Promise<void> => 
  clientManager.initialize();

export const closeRedis = (): Promise<void> => 
  clientManager.close();

export const isRedisReady = (): boolean => 
  clientManager.isReady();

export const getPublisher = (): RedisClientType => 
  clientManager.getPublisher();

export const getSubscriber = (): RedisClientType => 
  clientManager.getSubscriber();

export const publishToRoom = (roomName: string, message: unknown): Promise<void> =>
  withErrorHandling(
    async () => {
      const publisher = getPublisher();
      await publisher.publish(
        buildRoomMessagesKey(roomName),
        JSON.stringify(message)
      );
    },
    `Failed to publish to room ${roomName}`
  );

export const publishRoomEvent = (roomName: string, event: unknown): Promise<void> =>
  withErrorHandling(
    async () => {
      const publisher = getPublisher();
      await publisher.publish(
        buildRoomEventsKey(roomName),
        JSON.stringify(event)
      );
    },
    `Failed to publish room event for ${roomName}`
  );

export const subscribeToRoomMessages = async (
  roomName: string,
  callback: (message: unknown) => void
): Promise<void> => {
  const subscriber = getSubscriber();
  await subscriber.subscribe(buildRoomMessagesKey(roomName), (message) => {
    try {
      const parsed = JSON.parse(message);
      callback(parsed);
    } catch (error) {
      console.error("Failed to parse room message:", error);
    }
  });
};

export const subscribeToRoomEvents = async (
  roomName: string,
  callback: (event: unknown) => void
): Promise<void> => {
  const subscriber = getSubscriber();
  await subscriber.subscribe(buildRoomEventsKey(roomName), (message) => {
    try {
      const parsed = JSON.parse(message);
      callback(parsed);
    } catch (error) {
      console.error("Failed to parse room event:", error);
    }
  });
};

export const unsubscribeFromRoomMessages = (roomName: string): Promise<void> =>
  withErrorHandling(
    async () => {
      await getSubscriber().unsubscribe(buildRoomMessagesKey(roomName));
    },
    `Failed to unsubscribe from room ${roomName}`,
    undefined
  );

export const unsubscribeFromRoomEvents = (roomName: string): Promise<void> =>
  withErrorHandling(
    async () => {
      await getSubscriber().unsubscribe(buildRoomEventsKey(roomName));
    },
    `Failed to unsubscribe from room events for ${roomName}`,
    undefined
  );

export const addParticipantToRoom = (
  roomName: string,
  socketId: string
): Promise<void> =>
  withErrorHandling(
    async () => {
      await getPublisher().sAdd(buildRoomParticipantsKey(roomName), socketId);
    },
    `Failed to add participant to room ${roomName}`,
    undefined
  );

export const removeParticipantFromRoom = (
  roomName: string,
  socketId: string
): Promise<void> =>
  withErrorHandling(
    async () => {
      await getPublisher().sRem(buildRoomParticipantsKey(roomName), socketId);
    },
    `Failed to remove participant from room ${roomName}`,
    undefined
  );

export const getRoomParticipants = (roomName: string): Promise<string[]> =>
  withErrorHandling(
    () => getPublisher().sMembers(buildRoomParticipantsKey(roomName)),
    `Failed to get participants for room ${roomName}`,
    []
  );

export const setSocketMetadata = async (
  socketId: string,
  metadata: SocketMetadata
): Promise<void> => {
  await withErrorHandling(
    async () => {
      const publisher = getPublisher();
      const key = buildSocketMetadataKey(socketId);
      
      await publisher.hSet(key, {
        userId: metadata.userId,
        roomName: metadata.roomName,
        serverId: metadata.serverId || "default",
      });
      
      await publisher.expire(key, SOCKET_METADATA_TTL);
    },
    `Failed to set socket metadata for ${socketId}`,
    undefined
  );
};

export const getSocketMetadata = (
  socketId: string
): Promise<SocketMetadata | null> =>
  withErrorHandling(
    async () => {
      const publisher = getPublisher();
      const metadata = await publisher.hGetAll(buildSocketMetadataKey(socketId));
      
      if (Object.keys(metadata).length === 0) {
        return null;
      }
      
      return {
        userId: metadata.userId,
        roomName: metadata.roomName,
        serverId: metadata.serverId || "default",
      };
    },
    `Failed to get socket metadata for ${socketId}`,
    null
  );

export const removeSocketMetadata = (socketId: string): Promise<void> =>
  withErrorHandling(
    async () => {
      await getPublisher().del(buildSocketMetadataKey(socketId));
    },
    `Failed to remove socket metadata for ${socketId}`,
    undefined
  );