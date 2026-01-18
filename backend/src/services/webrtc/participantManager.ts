import prisma from "../../utils/prisma";
import { Participant } from "../../utils/webrtcTypes";
import {
  addParticipantToRoom,
  removeParticipantFromRoom,
  getRoomParticipants as getRedisRoomParticipants,
  setSocketMetadata,
  removeSocketMetadata,
} from "./redisManager";

// In-memory participant tracking: socketId -> Participant
const participants = new Map<string, Participant>();

// Room tracking: roomName -> Set<socketId>
const roomParticipants = new Map<string, Set<string>>();

const MAX_ROOM_SIZE = parseInt(process.env.MAX_ROOM_SIZE || "50", 10);

/**
 * Get participant by socket ID
 */
export function getParticipant(socketId: string): Participant | undefined {
  return participants.get(socketId);
}

/**
 * Get all participants in a room
 */
export function getRoomParticipants(roomName: string): Participant[] {
  const socketIds = roomParticipants.get(roomName);
  if (!socketIds) {
    return [];
  }

  return Array.from(socketIds)
    .map((socketId) => participants.get(socketId))
    .filter((p): p is Participant => p !== undefined);
}

/**
 * Join a room
 */
export async function joinRoom(
  socketId: string,
  userId: string,
  username: string,
  roomName: string,
  peerRole: string = "participant"
): Promise<{ success: boolean; error?: string; participants: Participant[] }> {
  try {
    // Check room size limit
    const currentParticipants = getRoomParticipants(roomName);
    if (currentParticipants.length >= MAX_ROOM_SIZE) {
      return {
        success: false,
        error: "Room is full",
        participants: currentParticipants,
      };
    }

    // Ensure room exists in database
    let room = await prisma.room.findUnique({
      where: { name: roomName },
    });

    if (!room) {
      room = await prisma.room.create({
        data: {
          name: roomName,
          maxPeers: MAX_ROOM_SIZE,
        },
      });
    }

    // Check if room is locked (future feature)
    if (room.isLocked) {
      // For now, allow join - can add host approval logic later
    }

    // Get or create user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return {
        success: false,
        error: "User not found",
        participants: [],
      };
    }

    // Create or update participant in database
    await prisma.roomParticipant.upsert({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: user.id,
        },
      },
      create: {
        roomId: room.id,
        userId: user.id,
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

    // Add to in-memory tracking
    const participant: Participant = {
      userId: user.id,
      socketId,
      name: user.name,
      isAudioMuted: false,
      isVideoMuted: false,
      joinedAt: new Date().toISOString(),
      peerRole,
    };

    participants.set(socketId, participant);

    // Add to room
    if (!roomParticipants.has(roomName)) {
      roomParticipants.set(roomName, new Set());
    }
    roomParticipants.get(roomName)!.add(socketId);

    // Sync with Redis
    await addParticipantToRoom(roomName, socketId);
    await setSocketMetadata(socketId, {
      userId: user.id,
      roomName,
    });

    // Get all participants
    const allParticipants = getRoomParticipants(roomName);

    return {
      success: true,
      participants: allParticipants,
    };
  } catch (error) {
    console.error("Error joining room:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      participants: [],
    };
  }
}

/**
 * Leave a room
 */
export async function leaveRoom(
  socketId: string,
  roomName: string
): Promise<void> {
  try {
    const participant = participants.get(socketId);
    if (!participant) {
      return;
    }

    // Remove from in-memory tracking
    participants.delete(socketId);

    // Remove from room
    const roomSet = roomParticipants.get(roomName);
    if (roomSet) {
      roomSet.delete(socketId);
      if (roomSet.size === 0) {
        roomParticipants.delete(roomName);
      }
    }

    // Remove from database
    await prisma.roomParticipant.deleteMany({
      where: {
        socketId,
      },
    });

    // Remove from Redis
    await removeParticipantFromRoom(roomName, socketId);
    await removeSocketMetadata(socketId);
  } catch (error) {
    console.error("Error leaving room:", error);
  }
}

/**
 * Update participant mute state
 */
export async function updateMuteState(
  socketId: string,
  audioMuted?: boolean,
  videoMuted?: boolean
): Promise<Participant | null> {
  try {
    const participant = participants.get(socketId);
    if (!participant) {
      return null;
    }

    // Update in-memory
    if (audioMuted !== undefined) {
      participant.isAudioMuted = audioMuted;
    }
    if (videoMuted !== undefined) {
      participant.isVideoMuted = videoMuted;
    }

    // Update database
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
}

/**
 * Cleanup participant on disconnect
 */
export async function cleanupParticipant(socketId: string): Promise<void> {
  const participant = participants.get(socketId);
  if (!participant) {
    return;
  }

  // Find room name from Redis or in-memory
  let roomName: string | undefined;

  // Try to find in roomParticipants map
  for (const [room, socketIds] of roomParticipants.entries()) {
    if (socketIds.has(socketId)) {
      roomName = room;
      break;
    }
  }

  if (roomName) {
    await leaveRoom(socketId, roomName);
  } else {
    // Fallback: remove from database directly
    await prisma.roomParticipant.deleteMany({
      where: { socketId },
    });
    await removeSocketMetadata(socketId);
    participants.delete(socketId);
  }
}

/**
 * Get participant count for a room
 */
export function getRoomParticipantCount(roomName: string): number {
  return roomParticipants.get(roomName)?.size || 0;
}

/**
 * Check if participant is in a room
 */
export function isParticipantInRoom(
  socketId: string,
  roomName: string
): boolean {
  return roomParticipants.get(roomName)?.has(socketId) || false;
}

/**
 * Get all rooms with participants
 */
export function getAllRooms(): string[] {
  return Array.from(roomParticipants.keys());
}

/**
 * Get total participant count across all rooms
 */
export function getTotalParticipantCount(): number {
  return participants.size;
}
