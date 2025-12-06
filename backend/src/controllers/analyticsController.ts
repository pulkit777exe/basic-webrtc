import { Response } from "express";
import { z } from "zod";
import prisma from "../prisma";
import { extractBrowserInfo } from "../utils/browserInfo";
import { AuthRequest } from "../middleware/auth";

const TrackEventSchema = z.object({
  eventType: z.enum([
    "page_view",
    "room_join",
    "room_leave",
    "message_sent",
    "video_enabled",
    "video_disabled",
    "audio_enabled",
    "audio_disabled",
    "screen_share_started",
    "screen_share_stopped",
    "recording_started",
    "recording_stopped",
  ]),
  roomName: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  browserInfo: z.record(z.unknown()).optional(),
  sessionId: z.string(),
});

export const trackEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || null;
    const { eventType, roomName, metadata, browserInfo: clientBrowserInfo, sessionId } =
      TrackEventSchema.parse(req.body);

    let roomId: string | null = null;
    if (roomName) {
      const room = await prisma.room.findFirst({
        where: { name: roomName },
      });
      roomId = room?.id || null;
    }

    const browserInfo = extractBrowserInfo(req, clientBrowserInfo);

    await prisma.analytics.create({
      data: {
        roomId,
        userId,
        eventType,
        browserInfo: browserInfo as any,
        sessionId,
        metadata: metadata || {},
      },
    });

    res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    console.error("Error tracking event:", error);
    res.status(500).json({ error: "Failed to track event" });
  }
};

const BatchEventSchema = z.object({
  events: z.array(
    z.object({
      eventType: z.enum([
        "page_view",
        "room_join",
        "room_leave",
        "message_sent",
        "video_enabled",
        "video_disabled",
        "audio_enabled",
        "audio_disabled",
        "screen_share_started",
        "screen_share_stopped",
        "recording_started",
        "recording_stopped",
      ]),
      timestamp: z.string().optional(),
      roomName: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
      browserInfo: z.record(z.unknown()).optional(),
      sessionId: z.string(),
      retryCount: z.number().optional().default(0),
    })
  ),
});

export const trackBatch = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || null;
    const { events } = BatchEventSchema.parse(req.body);

    if (events.length === 0) {
      return res.status(400).json({ error: "Events array cannot be empty" });
    }

    // Limit batch size to prevent abuse
    const MAX_BATCH_SIZE = 100;
    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({ 
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} events` 
      });
    }

    // Get unique room names to batch room lookups
    const uniqueRoomNames = [...new Set(events.map(e => e.roomName).filter(Boolean))];
    const roomMap = new Map<string, string | null>();

    // Batch fetch all rooms at once
    if (uniqueRoomNames.length > 0) {
      const rooms = await prisma.room.findMany({
        where: {
          name: { in: uniqueRoomNames as string[] },
        },
        select: { id: true, name: true },
      });

      rooms.forEach(room => {
        roomMap.set(room.name, room.id);
      });

      // Set null for rooms that don't exist
      uniqueRoomNames.forEach(name => {
        if (!roomMap.has(name)) {
          roomMap.set(name, null);
        }
      });
    }

    // Merge server-side browser info with client-side info once
    const serverBrowserInfo = extractBrowserInfo(req, {});

    // Prepare all analytics records
    const analyticsData = events.map((event) => {
      const roomId = event.roomName ? roomMap.get(event.roomName) || null : null;
      
      // Merge browser info (client info takes precedence)
      const browserInfo = {
        ...serverBrowserInfo,
        ...(event.browserInfo || {}),
      };

      return {
        roomId,
        userId,
        eventType: event.eventType,
        browserInfo: browserInfo as any,
        sessionId: event.sessionId,
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        metadata: {
          ...(event.metadata || {}),
          retryCount: event.retryCount || 0,
        },
      };
    });

    // Use createMany for better performance (if supported) or batch creates
    try {
      // Try createMany first (faster, but doesn't return created records)
      await prisma.analytics.createMany({
        data: analyticsData,
        skipDuplicates: true, // Skip duplicates if any
      });
    } catch (error) {
      // Fallback to individual creates if createMany fails
      console.warn("createMany failed, falling back to individual creates:", error);
      await Promise.all(
        analyticsData.map(data => prisma.analytics.create({ data }))
      );
    }

    res.status(201).json({
      success: true,
      processed: events.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Invalid batch data",
        details: error.issues 
      });
    }
    console.error("Error tracking batch events:", error);
    res.status(500).json({ 
      error: "Failed to track batch events",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const getAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, startDate, endDate, eventType } = req.query;

    const where: any = {};
    if (roomName) {
      const room = await prisma.room.findFirst({
        where: { name: roomName as string },
      });
      if (room) {
        where.roomId = room.id;
      }
    }
    if (eventType) {
      where.eventType = eventType;
    }
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    const analytics = await prisma.analytics.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 1000,
    });

    res.json({ analytics });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
};

