import { Router, Request, Response } from "express";
import { db } from "../db";
import { rooms, users } from "../db/schema";
import { authenticateToken } from "../middleware/auth";
import { generateRoomId } from "../utils/validation";
import { eq, and, gt } from "drizzle-orm";

const router = Router();

router.post(
  "/create",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { type = "open" } = req.body;
      const userId = req.authUser!.userId;

      const roomCode = generateRoomId();
      const expiryHours = parseInt(process.env.ROOM_EXPIRY_HOURS || "24");
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

      const result = await db
        .insert(rooms)
        .values({
          roomCode,
          type,
          hostUserId: userId,
          expiresAt,
        })
        .returning();

      res.status(201).json({ room: result[0] });
    } catch (error) {
      console.error("[Create Room Error]", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get("/:roomCode", async (req, res) => {
  try {
    const { roomCode } = req.params;

    const result = await db
      .select({
        id: rooms.id,
        roomCode: rooms.roomCode,
        type: rooms.type,
        hostUserId: rooms.hostUserId,
        hostUsername: users.username,
        createdAt: rooms.createdAt,
        expiresAt: rooms.expiresAt,
      })
      .from(rooms)
      .leftJoin(users, eq(rooms.hostUserId, users.id))
      .where(and(eq(rooms.roomCode, roomCode), gt(rooms.expiresAt, new Date())))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: "Room not found or expired" });
    }

    res.json({ room: result[0] });
  } catch (error) {
    console.error("[Get Room Error]", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/my/rooms",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.authUser!.userId;

      const userRooms = await db
        .select()
        .from(rooms)
        .where(
          and(eq(rooms.hostUserId, userId), gt(rooms.expiresAt, new Date())),
        )
        .orderBy(rooms.createdAt);

      res.json({ rooms: userRooms });
    } catch (error) {
      console.error("[Get User Rooms Error]", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.delete(
  "/:roomCode",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { roomCode } = req.params;
      const userId = req.authUser!.userId;

      const result = await db
        .delete(rooms)
        .where(and(eq(rooms.roomCode, roomCode), eq(rooms.hostUserId, userId)))
        .returning();

      if (result.length === 0) {
        res.status(404).json({ error: "Room not found or unauthorized" });
        return;
      }

      res.json({ message: "Room deleted successfully" });
    } catch (error) {
      console.error("[Delete Room Error]", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
