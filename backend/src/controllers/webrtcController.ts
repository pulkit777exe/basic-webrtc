import { Response } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { getIceServers } from "../services/webrtc/turnCredentials";
import {
  getRoomParticipants,
  leaveRoom,
  updateMuteState,
} from "../services/webrtc/participantManager";
import prisma from "../utils/prisma";
import { generateRandomId } from "../utils/randomId";

const JoinRoomSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const UpdatePeerStateSchema = z.object({
  isAudioMuted: z.boolean().optional(),
  isVideoMuted: z.boolean().optional(),
});

type JoinRoomRequest = z.infer<typeof JoinRoomSchema>;
type UpdatePeerStateRequest = z.infer<typeof UpdatePeerStateSchema>;

const DEFAULT_MAX_PEERS = 50;
const DEFAULT_WS_PORT = "8080";
const DEFAULT_WS_PATH = "/ws";

const getWebSocketUrl = (): string => {
  if (process.env.WS_URL) {
    return process.env.WS_URL;
  }

  const wsPort = process.env.WS_PORT || DEFAULT_WS_PORT;
  const wsPath = process.env.WS_PATH || DEFAULT_WS_PATH;
  return `ws://localhost:${wsPort}${wsPath}`;
};

const getMaxRoomSize = (): number => {
  const envValue = process.env.MAX_ROOM_SIZE;
  return envValue ? parseInt(envValue, 10) : DEFAULT_MAX_PEERS;
};

const handleError = (
  error: unknown,
  res: Response,
  context: string
): Response => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.issues,
    });
  }

  console.error(`[WebRTCController] ${context}:`, error);

  return res.status(500).json({
    error: context,
    message: error instanceof Error ? error.message : "Unknown error",
  });
};

const validateRoomName = (roomName: string | undefined, res: Response): roomName is string => {
  if (!roomName) {
    res.status(400).json({ error: "Room name is required" });
    return false;
  }
  return true;
};

const findOrCreateRoom = async (roomName: string, userId: string) => {
  const existingRoom = await prisma.room.findUnique({
    where: { name: roomName },
  });

  if (existingRoom) {
    return existingRoom;
  }

  return prisma.room.create({
    data: {
      name: roomName,
      creator: userId,
      maxPeers: getMaxRoomSize(),
      hostId: userId,
    },
  });
};

export const getIceServersHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const iceServers = getIceServers();
    return res.json({ iceServers });
  } catch (error) {
    return handleError(error, res, "Failed to get ICE servers");
  }
};

export const createRoomHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const roomId = generateRandomId();

    const room = await prisma.room.create({
      data: {
        id: roomId,
        name: roomId, 
        creator: userId,
        participants: [],
      },
    });

    return res.json({ roomId: room.id });
  } catch (error) {
    return handleError(error, res, "Failed to create room");
  }
};

export const joinRoomHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName } = req.params;
    if (!validateRoomName(roomName, res)) {
      return res;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const body = JoinRoomSchema.parse(req.body || {});

    const room = await findOrCreateRoom(roomName, userId);

    const participants = getRoomParticipants(roomName);

    return res.json({
      roomId: room.id,
      roomName: room.name,
      participants,
      wsUrl: getWebSocketUrl(),
      maxPeers: room.maxPeers,
      isLocked: room.isLocked,
    });
  } catch (error) {
    return handleError(error, res, "Failed to join room");
  }
};

export const getParticipantsHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const { roomName } = req.params;
    if (!validateRoomName(roomName, res)) {
      return res;
    }

    const participants = getRoomParticipants(roomName);

    return res.json({ participants });
  } catch (error) {
    return handleError(error, res, "Failed to get participants");
  }
};

export const leaveRoomHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName } = req.params;
    if (!validateRoomName(roomName, res)) {
      return res;
    }

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

    return res.json({ success: true });
  } catch (error) {
    return handleError(error, res, "Failed to leave room");
  }
};

export const updatePeerStateHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName } = req.params;
    if (!validateRoomName(roomName, res)) {
      return res;
    }

    const body = UpdatePeerStateSchema.parse(req.body);

    const participant = await prisma.roomParticipant.findFirst({
      where: {
        userId,
        room: {
          name: roomName,
        },
      },
    });

    if (!participant) {
      return res.status(404).json({ error: "Participant not found in room" });
    }

    const updated = await updateMuteState(
      participant.socketId,
      body.isAudioMuted,
      body.isVideoMuted
    );

    if (!updated) {
      return res.status(404).json({ error: "Failed to update peer state" });
    }

    return res.json({
      success: true,
      participant: {
        socketId: updated.socketId,
        isAudioMuted: updated.isAudioMuted,
        isVideoMuted: updated.isVideoMuted,
      },
    });
  } catch (error) {
    return handleError(error, res, "Failed to update peer state");
  }
};