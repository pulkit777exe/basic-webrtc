import { Response } from "express";
import { z } from "zod";
import { extractBrowserInfo } from "../utils/browserInfo";
import prisma from "../utils/prisma";
import { AuthRequest } from "../middleware/auth";
import { TrackEventSchema, BatchEventSchema } from "../utils/types";
import type { Prisma } from "@prisma/client";

interface AnalyticsEvent {
  roomName?: string;
  browserInfo?: Record<string, unknown>;
  eventType: string;
  sessionId: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  retryCount?: number;
}

interface StateCheckResult {
  isSame: boolean;
  reason?: string;
}

const ALWAYS_STORE_EVENTS = ["room_join", "room_leave"] as const;
const RECENT_THRESHOLD_MS = 5000; // 5 seconds
const MAX_BATCH_SIZE = 100;
const MAX_ANALYTICS_RESULTS = 1000;

const hasMetadataChanged = (
  previous: Record<string, unknown> | null,
  current: Record<string, unknown> | null
): boolean => {
  return JSON.stringify(previous || {}) !== JSON.stringify(current || {});
};

async function isSameState(
  eventType: string,
  roomId: string | null,
  userId: string | null,
  sessionId: string,
  metadata: Prisma.InputJsonValue | null,
  browserInfo: Prisma.InputJsonValue
): Promise<boolean> {
  if (ALWAYS_STORE_EVENTS.includes(eventType as typeof ALWAYS_STORE_EVENTS[number])) {
    return false;
  }

  const where: Prisma.AnalyticsWhereInput = {
    eventType,
    sessionId,
    roomId: roomId || null,
    userId: userId || null,
  };

  const lastEvent = await prisma.analytics.findFirst({
    where,
    orderBy: { timestamp: "desc" },
    select: {
      metadata: true,
      timestamp: true,
    },
  });

  if (!lastEvent) {
    return false;
  }

  const timeDiff = Date.now() - new Date(lastEvent.timestamp).getTime();

  if (timeDiff >= RECENT_THRESHOLD_MS) {
    return false;
  }

  const lastMetadata = lastEvent.metadata as Record<string, unknown> | null;
  const currentMetadata = metadata as Record<string, unknown> | null;

  return !hasMetadataChanged(lastMetadata, currentMetadata);
}

const fetchRoomIdsByNames = async (
  roomNames: string[]
): Promise<Map<string, string | null>> => {
  const roomMap = new Map<string, string | null>();

  if (roomNames.length === 0) {
    return roomMap;
  }

  const rooms = await prisma.room.findMany({
    where: {
      name: { in: roomNames },
    },
    select: { id: true, name: true },
  });

  rooms.forEach((room) => {
    roomMap.set(room.name!, room.id);
  });

  roomNames.forEach((name) => {
    if (!roomMap.has(name)) {
      roomMap.set(name, null);
    }
  });

  return roomMap;
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

  console.error(`[AnalyticsController] ${context}:`, error);

  return res.status(500).json({
    error: context,
    message: error instanceof Error ? error.message : "Unknown error",
  });
};

const buildAnalyticsData = (
  eventType: string,
  roomId: string | null,
  userId: string | null,
  sessionId: string,
  browserInfo: Prisma.InputJsonValue,
  metadata: Prisma.InputJsonValue,
  timestamp?: Date
) => ({
  roomId,
  userId,
  eventType,
  browserInfo,
  sessionId,
  metadata,
  ...(timestamp && { timestamp }),
});

export const trackEvent = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
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
      const room = await prisma.room.findUnique({
        where: { name: roomName },
      });
      roomId = room?.id || null;
    }

    const browserInfo = extractBrowserInfo(req, clientBrowserInfo);
    const metadataValue = (metadata || {}) as Prisma.InputJsonValue;
    const browserInfoValue = browserInfo as unknown as Prisma.InputJsonValue;

    const sameState = await isSameState(
      eventType,
      roomId,
      userId,
      sessionId,
      metadataValue,
      browserInfoValue
    );

    if (sameState) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: "State unchanged",
      });
    }

    await prisma.analytics.create({
      data: buildAnalyticsData(
        eventType,
        roomId,
        userId,
        sessionId,
        browserInfoValue,
        metadataValue
      ),
    });

    return res.status(201).json({ success: true });
  } catch (error) {
    return handleError(error, res, "Failed to track event");
  }
};

export const trackBatch = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId || null;
    const { events } = BatchEventSchema.parse(req.body);

    if (events.length === 0) {
      return res.status(400).json({ error: "Events array cannot be empty" });
    }

    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} events`,
      });
    }

    const uniqueRoomNames = [
      ...new Set(
        events
          .map((e: AnalyticsEvent) => e.roomName)
          .filter((name): name is string => Boolean(name))
      ),
    ];

    const roomMap = await fetchRoomIdsByNames(uniqueRoomNames);

    const serverBrowserInfo = extractBrowserInfo(req, {});

    const analyticsDataPromises = events.map(async (event: AnalyticsEvent) => {
      const roomId = event.roomName ? roomMap.get(event.roomName) || null : null;

      const browserInfo = {
        ...serverBrowserInfo,
        ...(event.browserInfo || {}),
      };

      const metadataValue = {
        ...(event.metadata || {}),
        retryCount: event.retryCount || 0,
      } as Prisma.InputJsonValue;

      const browserInfoValue = browserInfo as Prisma.InputJsonValue;

      const sameState = await isSameState(
        event.eventType,
        roomId,
        userId,
        event.sessionId,
        metadataValue,
        browserInfoValue
      );

      if (sameState) {
        return null;
      }

      return buildAnalyticsData(
        event.eventType,
        roomId,
        userId,
        event.sessionId,
        browserInfoValue,
        metadataValue,
        event.timestamp ? new Date(event.timestamp) : undefined
      );
    });

    const analyticsDataResults = await Promise.all(analyticsDataPromises);
    const analyticsData = analyticsDataResults.filter(
      (data): data is NonNullable<typeof data> => data !== null
    );

    const skippedCount = events.length - analyticsData.length;

    if (analyticsData.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        skipped: skippedCount,
        message: "All events skipped (duplicate states)",
        timestamp: new Date().toISOString(),
      });
    }

    try {
      await prisma.analytics.createMany({
        data: analyticsData,
        skipDuplicates: true,
      });
    } catch (error) {
      console.warn(
        "[AnalyticsController] createMany failed, falling back to individual creates:",
        error
      );
      await Promise.all(analyticsData.map((data) => prisma.analytics.create({ data })));
    }

    return res.status(201).json({
      success: true,
      processed: analyticsData.length,
      skipped: skippedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleError(error, res, "Failed to track batch events");
  }
};

export const getAnalytics = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, startDate, endDate, eventType } = req.query;

    const where: Prisma.AnalyticsWhereInput = {};

    if (roomName) {
      const room = await prisma.room.findUnique({
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
      where.timestamp = {
        ...(startDate && { gte: new Date(startDate as string) }),
        ...(endDate && { lte: new Date(endDate as string) }),
      };
    }

    const analytics = await prisma.analytics.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: MAX_ANALYTICS_RESULTS,
    });

    return res.json({ analytics });
  } catch (error) {
    return handleError(error, res, "Failed to fetch analytics");
  }
};