import { Response } from "express";
import { z } from "zod";
import prisma, { Prisma } from "../utils/prisma";
import { extractBrowserInfo } from "../utils/browserInfo";
import { AuthRequest } from "../middleware/auth";
import {
  CreateMessageSchema,
  GetMessagesSchema,
  EditMessageSchema,
  MessageParamsSchema,
  type CreateMessageInput,
  type GetMessagesInput,
  type EditMessageInput,
  type MessageParamsInput,
} from "../utils/types";

export const createMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, content } = CreateMessageSchema.parse(req.body);

    // Find or create room
    let room = await prisma.room.findFirst({
      where: { name: roomName },
    });

    if (!room) {
      room = await prisma.room.create({
        data: { name: roomName },
      });
    }

    // Create message
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

    // Track analytics
    const browserInfo = extractBrowserInfo(req, req.body.browserInfo);
    await prisma.analytics.create({
      data: {
        roomId: room.id,
        userId,
        eventType: "message_sent",
        browserInfo: browserInfo as unknown as Prisma.InputJsonValue,
        sessionId: req.body.sessionId || "unknown",
        metadata: {
          messageLength: content.length,
          roomName,
        } as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({
      id: message.id,
      content: message.content,
      sender: message.user.name,
      senderId: message.user.id,
      timestamp: message.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    console.error("Error creating message:", error);
    res.status(500).json({ error: "Failed to create message" });
  }
};

export const getMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { roomName, limit, cursor } = GetMessagesSchema.parse({
      ...req.query,
      ...req.params,
    });

    // Find room
    const room = await prisma.room.findFirst({
      where: { name: roomName },
    });

    if (!room) {
      return res.json({ messages: [], nextCursor: null });
    }

    // Build query with proper typing
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

    const nextCursor = messages.length === limit ? messages[messages.length - 1].id : null;

    res.json({
      messages: messages.reverse().map((msg) => ({
        id: msg.id,
        content: msg.content,
        sender: msg.user.name,
        senderId: msg.user.id,
        timestamp: msg.createdAt,
      })),
      nextCursor,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
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

    // Find room
    const room = await prisma.room.findFirst({
      where: { name: roomName },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Find message and verify ownership
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        roomId: room.id,
        userId,
      },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found or you don't have permission to edit it" });
    }

    // Update message
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

    res.json({
      id: updatedMessage.id,
      content: updatedMessage.content,
      sender: updatedMessage.user.name,
      senderId: updatedMessage.user.id,
      timestamp: updatedMessage.createdAt,
      updatedAt: updatedMessage.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    console.error("Error editing message:", error);
    res.status(500).json({ error: "Failed to edit message" });
  }
};

export const deleteMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, messageId } = MessageParamsSchema.parse(req.params);

    // Find room
    const room = await prisma.room.findFirst({
      where: { name: roomName },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Find message and verify ownership
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        roomId: room.id,
        userId,
      },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found or you don't have permission to delete it" });
    }

    // Delete message
    await prisma.message.delete({
      where: { id: messageId },
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
};