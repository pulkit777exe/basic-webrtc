import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import {
  getIceServersHandler,
  createRoomHandler,
  joinRoomHandler,
  getParticipantsHandler,
  leaveRoomHandler,
  updatePeerStateHandler,
} from "../controllers/webrtcController";

const router = Router();

// Apply rate limiting
const webrtcRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per minute
  keyGenerator: (req) => {
    const userId = (req as any).userId;
    return `webrtc-${req.ip}-${userId || "anonymous"}`;
  },
});

// All routes require authentication
router.use(authenticate);
router.use(webrtcRateLimit);

// ICE servers endpoint
router.get("/ice-servers", getIceServersHandler);

// Create room endpoint
router.post("/create-room", createRoomHandler);

// Room endpoints
router.post("/rooms/:roomName/join", joinRoomHandler);
router.get("/rooms/:roomName/participants", getParticipantsHandler);
router.post("/rooms/:roomName/leave", leaveRoomHandler);
router.patch("/rooms/:roomName/state", updatePeerStateHandler);

export default router;
