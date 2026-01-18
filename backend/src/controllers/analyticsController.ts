import { Response } from "express";
import { z } from "zod";
import { extractBrowserInfo } from "../utils/browserInfo";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import {
  TrackEventSchema,
  BatchEventSchema,
} from "../utils/types";

// Events that should always be stored regardless of state
const ALWAYS_STORE_EVENTS = ["room_join", "room_leave"];

/**
 * Check if the analytics state is the same as the previous state
 * Compares eventType, roomId, userId, and relevant metadata
 */
async function isSameState(
  eventType: string,
  roomId: string | null,
  userId: string | null,
  sessionId: string,
  metadata: typeof prisma.InputJsonValue | null,
  browserInfo: typeof prisma.InputJsonValue
): Promise<boolean> {
  // Always store join/leave events
  if (ALWAYS_STORE_EVENTS.includes(eventType)) {
    return false;
  }

  // Find the most recent event for this user/session with the same eventType and roomId
  const where: typeof prisma.AnalyticsWhereInput = {
    eventType,
    sessionId,
    ...(roomId ? { roomId } : { roomId: null }),
    ...(userId ? { userId } : { userId: null }),
  };

  const lastEvent = await prisma.analytics.findFirst({
    where,
    orderBy: { timestamp: "desc" },
    select: {
      eventType: true,
      roomId: true,
      metadata: true,
      browserInfo: true,
      timestamp: true,
    },
  });

  if (!lastEvent) {
    return false; // No previous event, so this is new
  }

  // Check if the event happened very recently (within last 5 seconds)
  // If so, compare metadata to see if state actually changed
  const timeDiff = Date.now() - new Date(lastEvent.timestamp).getTime();
  const RECENT_THRESHOLD = 5000; // 5 seconds

  if (timeDiff < RECENT_THRESHOLD) {
    // Compare metadata to see if state changed
    const lastMetadata = lastEvent.metadata as Record<string, unknown> | null;
    const currentMetadata = metadata as Record<string, unknown> | null;

    // Simple deep comparison of metadata (for most cases, this is sufficient)
    const metadataChanged =
      JSON.stringify(lastMetadata || {}) !== JSON.stringify(currentMetadata || {});

    if (!metadataChanged) {
      // State is the same, skip storing
      return true;
    }
  }

  return false; // State is different or too old, store it
}

export const trackEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || null;
    const {
      eventType,
      roomName,
      metadata,
      browserInfo: clientBrowserInfo,
      sessionId,
    } = TrackEventSchema.parse(req.body);

    let roomId: string | null = null;
    if (roomName) {
      const room = await prisma.room.findFirst({
        where: { name: roomName },
      });
      roomId = room?.id || null;
    }

    const browserInfo = extractBrowserInfo(req, clientBrowserInfo);
    const metadataValue = (metadata || {}) as typeof prisma.InputJsonValue;
    const browserInfoValue = browserInfo as unknown as typeof prisma.InputJsonValue;

    // Check if state is the same as previous (skip if same, unless it's join/leave)
    const sameState = await isSameState(
      eventType,
      roomId,
      userId,
      sessionId,
      metadataValue,
      browserInfoValue
    );

    if (sameState) {
      // State hasn't changed, skip storing but return success
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "State unchanged",
      });
    }

    // Store the event
    await prisma.analytics.create({
      data: {
        roomId,
        userId,
        eventType,
        browserInfo: browserInfoValue,
        sessionId,
        metadata: metadataValue,
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

export const trackBatch = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || null;
    const { events } = BatchEventSchema.parse(req.body);

    if (events.length === 0) {
      return res.status(400).json({ error: "Events array cannot be empty" });
    }

    const MAX_BATCH_SIZE = 100;
    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} events`,
      });
    }

    const uniqueRoomNames = [
      ...new Set(
        events.map((e: { roomName?: string }) => e.roomName).filter(Boolean)
      ),
    ];
    const roomMap = new Map<string, string | null>();

    // Batch fetch all rooms at once
    if (uniqueRoomNames.length > 0) {
      const rooms = await prisma.room.findMany({
        where: {
          name: { in: uniqueRoomNames as string[] },
        },
        select: { id: true, name: true },
      });

      rooms.forEach((room: { name: string; id: string }) => {
        roomMap.set(room.name, room.id);
      });

      // Set null for rooms that don't exist
      uniqueRoomNames.forEach((name) => {
        if (name && !roomMap.has(name)) {
          roomMap.set(name, null);
        }
      });
    }

    // Merge server-side browser info with client-side info once
    const serverBrowserInfo = extractBrowserInfo(req, {});

    // Prepare all analytics records and filter out duplicate states
    const analyticsDataPromises = events.map(
      async (event: {
        roomName?: string;
        browserInfo?: Record<string, unknown>;
        eventType: string;
        sessionId: string;
        timestamp?: string;
        metadata?: Record<string, unknown>;
        retryCount?: number;
      }) => {
        const roomId = event.roomName
          ? roomMap.get(event.roomName) || null
          : null;

        // Merge browser info (client info takes precedence)
        const browserInfo = {
          ...serverBrowserInfo,
          ...(event.browserInfo || {}),
        };

        const metadataValue = {
          ...(event.metadata || {}),
          retryCount: event.retryCount || 0,
        } as typeof prisma.InputJsonValue;

        const browserInfoValue = browserInfo as typeof prisma.InputJsonValue;

        // Check if state is the same (always store join/leave events)
        const sameState = await isSameState(
          event.eventType,
          roomId,
          userId,
          event.sessionId,
          metadataValue,
          browserInfoValue
        );

        if (sameState) {
          return null; // Skip this event
        }

        return {
          roomId,
          userId,
          eventType: event.eventType,
          browserInfo: browserInfoValue,
          sessionId: event.sessionId,
          timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          metadata: metadataValue,
        };
      }
    );

    // Wait for all state checks to complete and filter out nulls
    const analyticsDataResults = await Promise.all(analyticsDataPromises);
    const analyticsData = analyticsDataResults.filter(
      (data): data is NonNullable<typeof data> => data !== null
    );

    const skippedCount = events.length - analyticsData.length;

    // If no events to store, return early
    if (analyticsData.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        skipped: skippedCount,
        message: "All events skipped (duplicate states)",
        timestamp: new Date().toISOString(),
      });
    }

    // Use createMany for better performance (if supported) or batch creates
    try {
      // Try createMany first (faster, but doesn't return created records)
      await prisma.analytics.createMany({
        data: analyticsData,
        skipDuplicates: true, // Skip duplicates if any
      });
    } catch (error) {
      // Fallback to individual creates if createMany fails
      console.warn(
        "createMany failed, falling back to individual creates:",
        error
      );
      await Promise.all(
        analyticsData.map((data) => prisma.analytics.create({ data }))
      );
    }

    res.status(201).json({
      success: true,
      processed: analyticsData.length,
      skipped: skippedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid batch data",
        details: error.issues,
      });
    }
    console.error("Error tracking batch events:", error);
    res.status(500).json({
      error: "Failed to track batch events",
      message: error instanceof Error ? error.message : "Unknown error",
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

    const where: typeof prisma.AnalyticsWhereInput = {};
    if (roomName) {
      const room = await prisma.room.findFirst({
        where: { name: roomName as string },
      });
      if (room) {
        where.roomId = room.id;
      }
    }
    if (eventType) {
      where.eventType = eventType as string;
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