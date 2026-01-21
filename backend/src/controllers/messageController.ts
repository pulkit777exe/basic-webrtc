import { Response } from "express";
import { z } from "zod";
import prisma from "../utils/prisma";
import { extractBrowserInfo, serializeBrowserInfo } from "../utils/browserInfo";
import { AuthRequest } from "../middleware/auth";
import {
  CreateMessageSchema,
  GetMessagesSchema,
  EditMessageSchema,
  MessageParamsSchema,
} from "../utils/types";
import type { Prisma } from "@prisma/client";

// Types
interface MessageResponse {
  id: string;
  content: string;
  sender: string;
  senderId: string;
  timestamp: Date;
  updatedAt?: Date;
}

interface PaginatedMessagesResponse {
  messages: MessageResponse[];
  nextCursor: string | null;
}

// Helper functions
const findOrCreateRoom = async (roomName: string) => {
  let room = await prisma.room.findFirst({ where: { name: roomName } });
  
  if (!room) {
    room = await prisma.room.create({ data: { name: roomName } });
  }
  
  return room;
};

const findRoomByName = async (roomName: string) => {
  return prisma.room.findFirst({ where: { name: roomName } });
};

const trackMessageAnalytics = async (
  roomId: string,
  userId: string,
  content: string,
  roomName: string,
  req: AuthRequest
) => {
  const browserInfo = extractBrowserInfo(req, req.body.browserInfo);
  const serializedBrowserInfo = serializeBrowserInfo(browserInfo);
  
  await prisma.analytics.create({
    data: {
      roomId,
      userId,
      eventType: "message_sent",
      browserInfo: serializedBrowserInfo as Prisma.InputJsonValue,
      sessionId: req.body.sessionId || "unknown",
      metadata: {
        messageLength: content.length,
        roomName,
      } as Prisma.InputJsonValue,
    },
  });
};

const formatMessage = (message: any): MessageResponse => ({
  id: message.id,
  content: message.content,
  sender: message.user.name,
  senderId: message.user.id,
  timestamp: message.createdAt,
  ...(message.updatedAt && { updatedAt: message.updatedAt }),
});

const handleError = (error: unknown, res: Response, defaultMessage: string) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.issues });
  }
  
  console.error(defaultMessage, error);
  return res.status(500).json({ error: defaultMessage });
};

// Controllers
export const createMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, content } = CreateMessageSchema.parse(req.body);

    const room = await findOrCreateRoom(roomName);

    const message = await prisma.message.create({
      data: {
        roomId: room.id,
        userId,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    await trackMessageAnalytics(room.id, userId, content, roomName, req);

    return res.status(201).json(formatMessage(message));
  } catch (error) {
    return handleError(error, res, "Failed to create message");
  }
};

export const getMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { roomName, limit, cursor } = GetMessagesSchema.parse({
      ...req.query,
      ...req.params,
    });

    const room = await findRoomByName(roomName);

    if (!room) {
      return res.json({ messages: [], nextCursor: null });
    }

    const where: Prisma.MessageWhereInput = { roomId: room.id };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const messages = await prisma.message.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    const response: PaginatedMessagesResponse = {
      messages: messages.reverse().map(formatMessage),
      nextCursor: messages.length === limit ? messages[messages.length - 1].id : null,
    };

    return res.json(response);
  } catch (error) {
    return handleError(error, res, "Failed to fetch messages");
  }
};

export const editMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, messageId } = MessageParamsSchema.parse(req.params);
    const { content } = EditMessageSchema.parse(req.body);

    const room = await findRoomByName(roomName);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const existingMessage = await prisma.message.findFirst({
      where: {
        id: messageId,
        roomId: room.id,
        userId,
      },
    });

    if (!existingMessage) {
      return res.status(404).json({ 
        error: "Message not found or you don't have permission to edit it" 
      });
    }

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: { content },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    return res.json(formatMessage(updatedMessage));
  } catch (error) {
    return handleError(error, res, "Failed to edit message");
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, messageId } = MessageParamsSchema.parse(req.params);

    const room = await findRoomByName(roomName);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        roomId: room.id,
        userId,
      },
    });

    if (!message) {
      return res.status(404).json({ 
        error: "Message not found or you don't have permission to delete it" 
      });
    }

    await prisma.message.delete({
      where: { id: messageId },
    });

    return res.status(204).send();
  } catch (error) {
    return handleError(error, res, "Failed to delete message");
  }
};