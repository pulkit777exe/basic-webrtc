import { Router } from "express";
import { createMessage, getMessages, editMessage, deleteMessage } from "../controllers/messageController";
import { authenticate, optionalAuth } from "../middleware/auth";

const router = Router();

router.post("/", authenticate, createMessage);
router.get("/:roomName", optionalAuth, getMessages);
router.patch("/:roomName/:messageId", authenticate, editMessage);
router.delete("/:roomName/:messageId", authenticate, deleteMessage);

export default router;

