import { Request, Response } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { getIceServers } from "../services/webrtc/turnCredentials";
import {
  getRoomParticipants,
  joinRoom,
  leaveRoom,
  updateMuteState,
} from "../services/webrtc/participantManager";
import prisma from "../utils/prisma";

const JoinRoomSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdatePeerStateSchema = z.object({
  isAudioMuted: z.boolean().optional(),
  isVideoMuted: z.boolean().optional(),
});

/**
 * Get ICE server configuration
 * GET /api/webrtc/ice-servers
 */
export const getIceServersHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const iceServers = getIceServers();
    res.json({ iceServers });
  } catch (error) {
    console.error("Error getting ICE servers:", error);
    res.status(500).json({
      error: "Failed to get ICE servers",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Join a room
 * POST /api/rooms/:roomName/join
 */
export const joinRoomHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const roomName = req.params.roomName;

    if (!roomName) {
      res.status(400).json({ error: "Room name is required" });
      return;
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Parse request body
    const body = JoinRoomSchema.parse(req.body || {});

    // Join room (socketId will be generated when WebSocket connects)
    // For now, we'll just ensure the room exists
    let room = await prisma.room.findUnique({
      where: { name: roomName },
    });

    if (!room) {
      const maxPeers = parseInt(process.env.MAX_ROOM_SIZE || "50", 10);
      room = await prisma.room.create({
        data: {
          name: roomName,
          maxPeers,
          hostId: userId, // First joiner becomes host
        },
      });
    }

    // Get current participants
    const participants = getRoomParticipants(roomName);

    // Get WebSocket URL
    const wsPort = process.env.WS_PORT || "8080";
    const wsPath = process.env.WS_PATH || "/ws";
    const wsUrl = process.env.WS_URL || `ws://localhost:${wsPort}${wsPath}`;

    res.json({
      roomId: room.id,
      roomName: room.name,
      participants,
      wsUrl,
      maxPeers: room.maxPeers,
      isLocked: room.isLocked,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }

    console.error("Error joining room:", error);
    res.status(500).json({
      error: "Failed to join room",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Get room participants
 * GET /api/rooms/:roomName/participants
 */
export const getParticipantsHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const roomName = req.params.roomName;

    if (!roomName) {
      res.status(400).json({ error: "Room name is required" });
      return;
    }

    const participants = getRoomParticipants(roomName);

    res.json({ participants });
  } catch (error) {
    console.error("Error getting participants:", error);
    res.status(500).json({
      error: "Failed to get participants",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Leave a room
 * POST /api/rooms/:roomName/leave
 */
export const leaveRoomHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const roomName = req.params.roomName;

    if (!roomName) {
      res.status(400).json({ error: "Room name is required" });
      return;
    }

    // Find participant by userId and roomName
    const participant = await prisma.roomParticipant.findFirst({
      where: {
        userId,
        room: {
          name: roomName,
        },
      },
    });

    if (participant) {
      await leaveRoom(participant.socketId, roomName);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error leaving room:", error);
    res.status(500).json({
      error: "Failed to leave room",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Update peer state (mute/unmute)
 * PATCH /api/rooms/:roomName/state
 */
export const updatePeerStateHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const roomName = req.params.roomName;

    if (!roomName) {
      res.status(400).json({ error: "Room name is required" });
      return;
    }

    const body = UpdatePeerStateSchema.parse(req.body);

    // Find participant by userId and roomName
    const participant = await prisma.roomParticipant.findFirst({
      where: {
        userId,
        room: {
          name: roomName,
        },
      },
    });

    if (!participant) {
      res.status(404).json({ error: "Participant not found in room" });
      return;
    }

    const updated = await updateMuteState(
      participant.socketId,
      body.isAudioMuted,
      body.isVideoMuted
    );

    if (!updated) {
      res.status(404).json({ error: "Failed to update peer state" });
      return;
    }

    res.json({
      success: true,
      participant: {
        socketId: updated.socketId,
        isAudioMuted: updated.isAudioMuted,
        isVideoMuted: updated.isVideoMuted,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }

    console.error("Error updating peer state:", error);
    res.status(500).json({
      error: "Failed to update peer state",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
