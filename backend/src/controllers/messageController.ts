import { Response } from "express";
import { z } from "zod";
import prisma from "../prisma";
import { extractBrowserInfo } from "../utils/browserInfo";
import { AuthRequest } from "../middleware/auth";

const CreateMessageSchema = z.object({
  roomName: z.string().min(1),
  content: z.string().min(1).max(5000),
});

const GetMessagesSchema = z.object({
  roomName: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
  cursor: z.string().optional(),
});

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
        browserInfo: browserInfo as any,
        sessionId: req.body.sessionId || "unknown",
        metadata: {
          messageLength: content.length,
          roomName,
        },
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
    const room = await prisma.room.findUnique({
      where: { name: roomName },
    });

    if (!room) {
      return res.json({ messages: [], nextCursor: null });
    }

    // Build query
    const where: any = { roomId: room.id };
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
      messages: messages
        .reverse()
        .map((msg) => ({
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

