import type { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import prisma from "../utils/prisma";
import fs from "fs";
import path from "path";

const UploadRecordingQuerySchema = z.object({
  roomName: z.string().min(1),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
});

export const uploadRecordingHandler = async (
  req: AuthRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { roomName, startedAt, endedAt } = UploadRecordingQuerySchema.parse(
      req.query
    );

    const body = req.body as Buffer;
    if (!body || !Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: "Empty recording payload" });
    }

    const room = await prisma.room.findUnique({
      where: { name: roomName },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const recordingsDir =
      process.env.RECORDINGS_DIR ||
      path.join(process.cwd(), "recordings");
    fs.mkdirSync(recordingsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `recording_${room.id}_${timestamp}.webm`;
    const filePath = path.join(recordingsDir, fileName);

    fs.writeFileSync(filePath, body);

    const startedAtDate = startedAt ? new Date(startedAt) : new Date();
    const endedAtDate = endedAt ? new Date(endedAt) : new Date();

    const recording = await prisma.recording.create({
      data: {
        roomId: room.id,
        userId,
        filePath,
        startedAt: startedAtDate,
        endedAt: endedAtDate,
      },
    });

    return res.status(201).json({
      id: recording.id,
      roomId: recording.roomId,
      userId: recording.userId,
      createdAt: recording.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Validation failed",
        details: error.issues,
      });
    }

    console.error("[RecordingController] Failed to upload recording:", error);
    return res.status(500).json({
      error: "Failed to upload recording",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

