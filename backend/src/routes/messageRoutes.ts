import { Router } from "express";
import { createMessage, getMessages } from "../controllers/messageController";
import { authenticate, optionalAuth } from "../middleware/auth";

const router = Router();

router.post("/", authenticate, createMessage);
router.get("/:roomName", optionalAuth, getMessages);

export default router;

