import prisma from "../../utils/prisma";
import { Participant } from "../../utils/webrtcTypes";
import {
  addParticipantToRoom,
  removeParticipantFromRoom,
  setSocketMetadata,
  removeSocketMetadata,
} from "./redisManager";

const MAX_ROOM_SIZE = parseInt(process.env.MAX_ROOM_SIZE || "50", 10);

class ParticipantStore {
  private participants = new Map<string, Participant>();
  private roomParticipants = new Map<string, Set<string>>();

  getParticipant(socketId: string): Participant | undefined {
    return this.participants.get(socketId);
  }

  setParticipant(socketId: string, participant: Participant): void {
    this.participants.set(socketId, participant);
  }

  deleteParticipant(socketId: string): void {
    this.participants.delete(socketId);
  }

  getRoomSocketIds(roomName: string): Set<string> {
    return this.roomParticipants.get(roomName) || new Set();
  }

  addToRoom(roomName: string, socketId: string): void {
    if (!this.roomParticipants.has(roomName)) {
      this.roomParticipants.set(roomName, new Set());
    }
    this.roomParticipants.get(roomName)!.add(socketId);
  }

  removeFromRoom(roomName: string, socketId: string): void {
    const roomSet = this.roomParticipants.get(roomName);
    if (roomSet) {
      roomSet.delete(socketId);
      if (roomSet.size === 0) {
        this.roomParticipants.delete(roomName);
      }
    }
  }

  findRoomBySocket(socketId: string): string | undefined {
    for (const [roomName, socketIds] of this.roomParticipants.entries()) {
      if (socketIds.has(socketId)) {
        return roomName;
      }
    }
    return undefined;
  }

  getAllRooms(): string[] {
    return Array.from(this.roomParticipants.keys());
  }

  getTotalParticipantCount(): number {
    return this.participants.size;
  }
}

const store = new ParticipantStore();

interface JoinRoomResult {
  success: boolean;
  error?: string;
  participants: Participant[];
}

interface RoomValidationResult {
  valid: boolean;
  error?: string;
  room?: { id: string; name: string; isLocked: boolean };
}

const validateRoomCapacity = (roomName: string): boolean => {
  const currentCount = store.getRoomSocketIds(roomName).size;
  return currentCount < MAX_ROOM_SIZE;
};

const findOrCreateRoom = async (roomName: string): Promise<RoomValidationResult> => {
  try {
    let room = await prisma.room.findUnique({
      where: { name: roomName },
      select: { id: true, name: true, isLocked: true },
    });

    if (!room) {
      room = await prisma.room.create({
        data: {
          name: roomName,
          maxPeers: MAX_ROOM_SIZE
        },
        select: { id: true, name: true, isLocked: true },
      });
    }

    return { valid: true, room };
  } catch (error) {
    console.error("Error finding/creating room:", error);
    return { valid: false, error: "Failed to access room" };
  }
};

const validateUser = async (userId: string): Promise<boolean> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return !!user;
  } catch (error) {
    console.error("Error validating user:", error);
    return false;
  }
};

const createParticipant = (
  userId: string,
  socketId: string,
  name: string,
  peerRole: string
): Participant => ({
  userId,
  socketId,
  name,
  isAudioMuted: false,
  isVideoMuted: false,
  joinedAt: new Date().toISOString(),
  peerRole,
});

const syncParticipantToDatabase = async (
  roomId: string,
  userId: string,
  socketId: string,
  peerRole: string
): Promise<void> => {
  await prisma.roomParticipant.upsert({
    where: {
      roomId_userId: { roomId, userId },
    },
    create: {
      roomId,
      userId,
      socketId,
      peerRole,
      isAudioMuted: false,
      isVideoMuted: false,
    },
    update: {
      socketId,
      lastSeenAt: new Date(),
    },
  });
};

const syncParticipantToRedis = async (
  roomName: string,
  socketId: string,
  userId: string
): Promise<void> => {
  await Promise.all([
    addParticipantToRoom(roomName, socketId),
    setSocketMetadata(socketId, { userId, roomName }),
  ]);
};

const cleanupParticipantFromDatabase = async (socketId: string): Promise<void> => {
  await prisma.roomParticipant.deleteMany({
    where: { socketId },
  });
};

const cleanupParticipantFromRedis = async (
  roomName: string,
  socketId: string
): Promise<void> => {
  await Promise.all([
    removeParticipantFromRoom(roomName, socketId),
    removeSocketMetadata(socketId),
  ]);
};

// Public API
export const getParticipant = (socketId: string): Participant | undefined => {
  return store.getParticipant(socketId);
};

export const getRoomParticipants = (roomName: string): Participant[] => {
  const socketIds = store.getRoomSocketIds(roomName);
  return Array.from(socketIds)
    .map((socketId) => store.getParticipant(socketId))
    .filter((p): p is Participant => p !== undefined);
};

export const joinRoom = async (
  socketId: string,
  userId: string,
  username: string,
  roomName: string,
  peerRole: string = "participant"
): Promise<JoinRoomResult> => {
  try {
    // Validate capacity
    if (!validateRoomCapacity(roomName)) {
      return {
        success: false,
        error: "Room is full",
        participants: getRoomParticipants(roomName),
      };
    }

    // Validate and get/create room
    const roomValidation = await findOrCreateRoom(roomName);
    if (!roomValidation.valid || !roomValidation.room) {
      return {
        success: false,
        error: roomValidation.error || "Room access denied",
        participants: [],
      };
    }

    // Validate user
    const userExists = await validateUser(userId);
    if (!userExists) {
      return {
        success: false,
        error: "User not found",
        participants: [],
      };
    }

    // Create participant
    const participant = createParticipant(userId, socketId, username, peerRole);

    // Sync to all storage layers
    await Promise.all([
      syncParticipantToDatabase(roomValidation.room.id, userId, socketId, peerRole),
      syncParticipantToRedis(roomName, socketId, userId),
    ]);

    // Update in-memory state
    store.setParticipant(socketId, participant);
    store.addToRoom(roomName, socketId);

    return {
      success: true,
      participants: getRoomParticipants(roomName),
    };
  } catch (error) {
    console.error("Error joining room:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      participants: [],
    };
  }
};

export const leaveRoom = async (
  socketId: string,
  roomName: string
): Promise<void> => {
  try {
    const participant = store.getParticipant(socketId);
    if (!participant) {
      return;
    }

    // Cleanup in parallel
    await Promise.all([
      cleanupParticipantFromDatabase(socketId),
      cleanupParticipantFromRedis(roomName, socketId),
    ]);

    // Update in-memory state
    store.deleteParticipant(socketId);
    store.removeFromRoom(roomName, socketId);
  } catch (error) {
    console.error("Error leaving room:", error);
    throw error;
  }
};

export const updateMuteState = async (
  socketId: string,
  audioMuted?: boolean,
  videoMuted?: boolean
): Promise<Participant | null> => {
  try {
    const participant = store.getParticipant(socketId);
    if (!participant) {
      return null;
    }

    // Update in-memory state
    if (audioMuted !== undefined) {
      participant.isAudioMuted = audioMuted;
    }
    if (videoMuted !== undefined) {
      participant.isVideoMuted = videoMuted;
    }

    // Sync to database
    await prisma.roomParticipant.updateMany({
      where: { socketId },
      data: {
        isAudioMuted: participant.isAudioMuted,
        isVideoMuted: participant.isVideoMuted,
        lastSeenAt: new Date(),
      },
    });

    return participant;
  } catch (error) {
    console.error("Error updating mute state:", error);
    return null;
  }
};

export const cleanupParticipant = async (socketId: string): Promise<void> => {
  const roomName = store.findRoomBySocket(socketId);
  
  if (roomName) {
    await leaveRoom(socketId, roomName);
  } else {
    await Promise.all([
      cleanupParticipantFromDatabase(socketId),
      removeSocketMetadata(socketId),
    ]);
    store.deleteParticipant(socketId);
  }
};

export const getRoomParticipantCount = (roomName: string): number => {
  return store.getRoomSocketIds(roomName).size;
};

export const isParticipantInRoom = (socketId: string, roomName: string): boolean => {
  return store.getRoomSocketIds(roomName).has(socketId);
};

export const getAllRooms = (): string[] => {
  return store.getAllRooms();
};

export const getTotalParticipantCount = (): number => {
  return store.getTotalParticipantCount();
};